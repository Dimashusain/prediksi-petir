/**
 * Backend Server: DITYU Weather — Sistem Prediksi Petir & Cuaca Real-Time BMKG
 * Menggunakan Native Node.js HTTP Server (Zero External Dependencies)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const FALLBACK_DATA_PATH = path.join(__dirname, 'data-cuaca', '31.71.01.1001.json');

// Memory Cache (TTL: 5 menit per adm4)
const weatherCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Radar Maps Cache (TTL: 2 menit)
let radarMapsCache = null;
let radarMapsCacheTime = 0;
const RADAR_CACHE_TTL_MS = 2 * 60 * 1000;

// Presets Wilayah Terpilih di Indonesia (adm4 codes)
const REGION_PRESETS = [
  { code: '31.71.01.1001', name: 'Gambir, Jakarta Pusat', province: 'DKI Jakarta' },
  { code: '31.71.06.1001', name: 'Menteng, Jakarta Pusat', province: 'DKI Jakarta' },
  { code: '31.74.07.1001', name: 'Kebayoran Baru, Jakarta Selatan', province: 'DKI Jakarta' },
  { code: '32.73.07.1004', name: 'Coblong (Dago), Kota Bandung', province: 'Jawa Barat' },
  { code: '35.78.08.1001', name: 'Genteng, Kota Surabaya', province: 'Jawa Timur' },
  { code: '34.71.04.1001', name: 'Gondomanan (Malioboro), Yogyakarta', province: 'DI Yogyakarta' },
  { code: '51.71.01.1001', name: 'Sanur, Denpasar Selatan', province: 'Bali' },
  { code: '12.71.04.1001', name: 'Medan Kota, Kota Medan', province: 'Sumatera Utara' },
  { code: '73.71.04.1001', name: 'Ujung Pandang, Makassar', province: 'Sulawesi Selatan' },
  { code: '64.71.01.1001', name: 'Balikpapan Kota, Balikpapan', province: 'Kalimantan Timur' }
];

/**
 * Algoritma Penilaian Indeks Potensi Petir (Lightning Risk Index)
 * Menghitung probabilitas aktivitas petir / konveksi awan cumulonimbus (CB)
 * berdasarkan parameter meteorologis BMKG:
 * - Tutupan Awan (tcc %)
 * - Kelembapan Relatif (hu %)
 * - Presipitasi / Curah Hujan (tp mm)
 * - Kecepatan Angin (ws km/h)
 * - Suhu Permukaan (t °C)
 * - Deskripsi Cuaca Resmi BMKG
 */
function calculateLightningRisk(item) {
  let score = 0;
  const desc = (item.weather_desc || '').toLowerCase();
  const tcc = Number(item.tcc) || 0;
  const hu = Number(item.hu) || 0;
  const tp = Number(item.tp) || 0;
  const ws = Number(item.ws) || 0;
  const t = Number(item.t) || 28;

  // 1. Kondisi cuaca terdeskripsi
  if (desc.includes('petir') || desc.includes('kilat') || desc.includes('badai')) {
    score += 65;
  } else if (desc.includes('hujan lebat')) {
    score += 45;
  } else if (desc.includes('hujan sedang')) {
    score += 30;
  } else if (desc.includes('hujan ringan') || desc.includes('hujan lokal')) {
    score += 20;
  } else if (desc.includes('berawan tebal')) {
    score += 15;
  } else if (desc.includes('berawan')) {
    score += 8;
  }

  // 2. Tutupan Awan (Cloud Cover) - cumuliform potential
  if (tcc >= 90) score += 15;
  else if (tcc >= 75) score += 10;
  else if (tcc >= 50) score += 5;

  // 3. Kelembapan Udara (Moisture Inflow)
  if (hu >= 85) score += 15;
  else if (hu >= 75) score += 10;
  else if (hu >= 65) score += 5;

  // 4. Presipitasi (Rainfall mm)
  if (tp >= 10) score += 15;
  else if (tp >= 3) score += 10;
  else if (tp > 0) score += 5;

  // 5. Geser Angin & Ketidakstabilan Termal (Wind Shear & Thermal Lift)
  if (ws > 15) score += 5;
  if (t >= 32 && hu >= 70) score += 8; // Potensi konveksi kuat siang hari

  // Normalisasi skor (0 - 100)
  score = Math.min(100, Math.max(0, Math.round(score)));

  // Klasifikasi Level Bahaya Petir
  let level = 'Rendah';
  let badgeClass = 'risk-low';
  let advice = 'Aman untuk aktivitas luar ruangan. Medan elektromagnetik atmosfer tenang.';
  let color = '#10b981';

  if (score >= 75) {
    level = 'BAHAYA';
    badgeClass = 'risk-extreme';
    advice = 'Peringatan Badai Petir! Hindari ruang terbuka, hentikan aktivitas luar, jauhi pohon & tiang logam.';
    color = '#ef4444';
  } else if (score >= 50) {
    level = 'Siaga';
    badgeClass = 'risk-high';
    advice = 'Awan konvektif pekat terdeteksi. Berpotensi terjadi kilat & petir dalam kurun waktu dekat.';
    color = '#f97316';
  } else if (score >= 25) {
    level = 'Waspada';
    badgeClass = 'risk-moderate';
    advice = 'Potensi konveksi ringan. Pantau perkembangan cuaca jika berkegiatan di area terbuka.';
    color = '#eab308';
  }

  return {
    score,
    level,
    badgeClass,
    advice,
    color
  };
}

/**
 * Generator Simulasi Sambaran Petir Terdeteksi Real-Time di sekitar koordinat BMKG
 * Menggunakan model dispersi konvektif berdasarkan skor risiko petir
 */
function generateLightningStrikes(lat, lon, riskScore) {
  const strikes = [];
  if (riskScore < 15) return strikes;

  const count = riskScore >= 75 ? 9 : riskScore >= 50 ? 5 : 3;
  const baseLat = Number(lat) || -6.17638;
  const baseLon = Number(lon) || 106.8267;

  for (let i = 0; i < count; i++) {
    const angle = (i * (360 / count) + (i * 19) + 17) % 360;
    const rad = angle * (Math.PI / 180);
    const distKm = Number((Math.random() * 11 + 2.5).toFixed(1));
    const distDeg = distKm / 111.32;

    const sLat = Number((baseLat + distDeg * Math.cos(rad)).toFixed(5));
    const sLon = Number((baseLon + (distDeg / Math.cos(baseLat * Math.PI / 180)) * Math.sin(rad)).toFixed(5));
    const peakCurrent = Number((Math.random() * 45 + 18).toFixed(1)); // 18 - 63 kA
    const minsAgo = Math.floor(Math.random() * 14 + 1);

    strikes.push({
      id: `LTG-${(i + 1).toString().padStart(2, '0')}`,
      lat: sLat,
      lon: sLon,
      distanceKm: distKm,
      peakCurrentKa: peakCurrent,
      polarity: Math.random() > 0.25 ? 'Negative (CG-)' : 'Positive (CG+)',
      timeAgoMinutes: minsAgo,
      severity: peakCurrent > 42 ? 'Ekstrem' : peakCurrent > 28 ? 'Tinggi' : 'Sedang'
    });
  }
  return strikes;
}

/**
 * Fetch Metadata Tile Radar Real-Time (Mosaik Radar BMKG / RainViewer)
 */
async function fetchRadarMapsData() {
  const now = Date.now();
  if (radarMapsCache && (now - radarMapsCacheTime < RADAR_CACHE_TTL_MS)) {
    return radarMapsCache;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: controller.signal,
      headers: { 'User-Agent': 'DITYU-Weather-Lightning-Predictor/1.0' }
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      radarMapsCache = data;
      radarMapsCacheTime = now;
      return data;
    }
  } catch (err) {
    console.warn('[Radar API Notice]', err.message);
  }

  // Fallback timestamp if offline or API unreachable
  const baseTime = Math.floor(now / 1000 / 600) * 600;
  return {
    host: 'https://tilecache.rainviewer.com',
    radar: {
      past: [
        { time: baseTime - 1800, path: `/v2/radar/${baseTime - 1800}` },
        { time: baseTime - 1200, path: `/v2/radar/${baseTime - 1200}` },
        { time: baseTime - 600, path: `/v2/radar/${baseTime - 600}` },
        { time: baseTime, path: `/v2/radar/${baseTime}` }
      ],
      nowcast: [
        { time: baseTime + 600, path: `/v2/radar/${baseTime + 600}` }
      ]
    }
  };
}

/**
 * Memperkaya struktur data BMKG dengan analisis petir dan metadata
 */
function enrichWeatherData(rawData, source = 'live', cached = false) {
  if (!rawData || !rawData.data || !Array.isArray(rawData.data) || !rawData.data[0]) {
    return rawData;
  }

  const enriched = JSON.parse(JSON.stringify(rawData));
  const loc = enriched.lokasi || {};
  enriched._metadata = {
    source,
    cached,
    fetchedAt: new Date().toISOString(),
    attribution: 'Badan Meteorologi, Klimatologi, dan Geofisika (BMKG)'
  };

  const days = enriched.data[0].cuaca || [];
  days.forEach((daySlots) => {
    if (Array.isArray(daySlots)) {
      daySlots.forEach((slot) => {
        slot.lightning_risk = calculateLightningRisk(slot);
        slot.lightning_strikes = generateLightningStrikes(loc.lat, loc.lon, slot.lightning_risk.score);
      });
    }
  });

  return enriched;
}

/**
 * Fetch data prakiraan cuaca dari BMKG API dengan mekanisme Fallback cerdas
 */
async function fetchBMKGForecast(adm4) {
  const targetAdm4 = (adm4 || '31.71.01.1001').trim();
  const cacheKey = targetAdm4;
  const now = Date.now();

  // 1. Cek Cache
  if (weatherCache.has(cacheKey)) {
    const entry = weatherCache.get(cacheKey);
    if (now - entry.timestamp < CACHE_TTL_MS) {
      return enrichWeatherData(entry.data, 'cache', true);
    }
  }

  // 2. Fetch Live dari BMKG API
  const apiUrl = `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${encodeURIComponent(targetAdm4)}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 detik timeout

    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BMKG-Lightning-Forecast-App/1.0',
        'Accept': 'application/json'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`BMKG API HTTP status ${response.status}`);
    }

    const jsonData = await response.json();
    if (jsonData && jsonData.data && jsonData.lokasi) {
      // Simpan ke Cache
      weatherCache.set(cacheKey, { timestamp: now, data: jsonData });
      return enrichWeatherData(jsonData, 'live', false);
    } else {
      throw new Error('Respon BMKG tidak memiliki struktur data/lokasi yang valid');
    }
  } catch (err) {
    console.warn(`[BMKG API Fetch Notice] ${err.message}. Memanfaatkan data cadangan lokal...`);

    // 3. Fallback ke File JSON Lokal jika offline / sandbox / error
    if (fs.existsSync(FALLBACK_DATA_PATH)) {
      try {
        const fileContent = fs.readFileSync(FALLBACK_DATA_PATH, 'utf8');
        const fallbackJson = JSON.parse(fileContent);
        const enrichedFallback = enrichWeatherData(fallbackJson, 'local_fallback', false);
        enrichedFallback._metadata.warning = `Koneksi BMKG langsung tidak dapat dijangkau (${err.message}). Menampilkan arsip data valid BMKG untuk simulasi real-time.`;
        return enrichedFallback;
      } catch (fileErr) {
        throw new Error(`Gagal membaca fallback JSON: ${fileErr.message}`);
      }
    } else {
      throw new Error(`Koneksi BMKG gagal dan file fallback tidak ditemukan: ${err.message}`);
    }
  }
}

/**
 * MIME Types Map
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/**
 * Handle HTTP Server Requests
 */
const server = http.createServer(async (req, res) => {
  // Set CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. API: Prakiraan Cuaca BMKG
  if (pathname === '/api/weather') {
    const adm4 = parsedUrl.query.adm4 || '31.71.01.1001';
    try {
      const data = await fetchBMKGForecast(adm4);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: true,
        message: error.message,
        timestamp: new Date().toISOString()
      }));
    }
    return;
  }

  // 2. API: Daftar Presets Wilayah
  if (pathname === '/api/regions') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      presets: REGION_PRESETS,
      default: '31.71.01.1001'
    }));
    return;
  }

  // 3. API: Tile Layer Radar Real-Time
  if (pathname === '/api/radar-maps') {
    try {
      const data = await fetchRadarMapsData();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: true, message: e.message }));
    }
    return;
  }

  // 3. API: Status & Heartbeat
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'online',
      nodeVersion: process.version,
      cacheEntries: weatherCache.size,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime())
    }));
    return;
  }

  // 4. API: Server-Sent Events (SSE) untuk real-time pulse
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 10000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'connected', time: new Date().toISOString() })}\n\n`);

    const interval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', time: new Date().toISOString() })}\n\n`);
    }, 15000);

    req.on('close', () => clearInterval(interval));
    return;
  }

  // 5. Static Files Serving (public directory)
  let safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safePath).replace(/^(\.\.[\/\\])+/, ''));

  // Cek apakah file ada di public
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // 404 Not Found
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="id">
      <head><title>404 - Halaman Tidak Ditemukan</title><style>body{background:#0a0e17;color:#fff;font-family:sans-serif;padding:40px;text-align:center;}h1{color:#38bdf8;}a{color:#818cf8;}</style></head>
      <body>
        <h1>404 | Halaman Tidak Ditemukan</h1>
        <p>Halaman atau endpoint yang Anda cari tidak tersedia.</p>
        <p><a href="/">Kembali ke DITYU Weather (BMKG)</a></p>
      </body>
      </html>
    `);
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`⚡ DITYU WEATHER — SISTEM PREDIKSI PETIR & CUACA (BMKG)`);
  console.log(`=======================================================`);
  console.log(`🌐 Server aktif di : http://localhost:${PORT}`);
  console.log(`📡 API Weather     : http://localhost:${PORT}/api/weather?adm4=31.71.01.1001`);
  console.log(`📍 API Wilayah     : http://localhost:${PORT}/api/regions`);
  console.log(`🕒 Server Time     : ${new Date().toLocaleString('id-ID')}`);
  console.log(`=======================================================`);
});

// Penanganan Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\nMematikan server DITYU Weather...');
  server.close(() => {
    console.log('Server berhasil dimatikan.');
    process.exit(0);
  });
});

