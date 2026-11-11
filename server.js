/**
 * Backend Server: DITYU Weather — Sistem Prediksi Petir & Cuaca Real-Time BMKG
 * Menggunakan Native Node.js HTTP Server (Zero External Dependencies)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load Environment Variables dari file .env lokal jika ada
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx !== -1) {
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed.slice(idx + 1).trim();
            if (!process.env[k]) process.env[k] = v;
          }
        }
      });
    } catch (e) {}
  }
}
loadEnv();

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

// Konfigurasi Database Supabase (REST API v1)
const SUPABASE_CONFIG = {
  url: process.env.SUPABASE_URL || 'https://xszdnejjmusxuojsnynq.supabase.co/rest/v1',
  key: process.env.SUPABASE_SECRET_KEY || ''
};

// State Model & Cache Korelasi Data Science dari Supabase
const supabaseModelState = {
  isSynced: false,
  lastSync: null,
  syncError: null,
  // Matriks korelasi EDA asli dari tabel weather_correlation_eda Supabase
  correlations: {
    suhu_kelembapan: -0.81418903297818,
    kelembapan_curah_hujan: 0.20647162404216,
    suhu_curah_hujan: -0.285302473705151,
    hujan_kecepatan_angin: -0.0505120376272596,
    suhu_kecepatan_angin: 0.317170457509822,
    tn_tx: 0.0702245618383167
  },
  // Parameter baseline & threshold transformasi dari tabel weather_clean Supabase
  baselineStats: {
    tavg_mean: 27.17,
    rh_mean: 87.45,
    rr_mean: 10.14,
    ff_mean: 4.29,
    peak_current_threshold: 19.0, // Sesuai dataCleaning.py: df['peak_current'].abs() >= 19.0
    sensor_uptime_min: 0.90       // Sesuai dataCleaning.py: sensor_uptime > 0.90
  },
  sampleCorrelations: null,
  missingEda: null
};

/**
 * Helper Fetch ke Supabase REST API
 */
async function fetchSupabaseTable(endpoint) {
  const urlStr = SUPABASE_CONFIG.url.replace(/\/+$/, '') + '/' + endpoint.replace(/^\/+/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(urlStr, {
      signal: controller.signal,
      headers: {
        'apikey': SUPABASE_CONFIG.key,
        'Authorization': `Bearer ${SUPABASE_CONFIG.key}`,
        'Accept': 'application/json',
        'User-Agent': 'DITYU-Weather-Supabase-Engine/1.0'
      }
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Sinkronisasi Model Prediksi Petir & Matriks Korelasi dari Supabase
 */
async function syncSupabaseModel() {
  try {
    // 1. Ambil koefisien korelasi EDA
    const corrData = await fetchSupabaseTable('weather_correlation_eda');
    if (Array.isArray(corrData) && corrData.length > 0 && corrData[0].suhu_kelembapan !== undefined) {
      supabaseModelState.correlations = {
        suhu_kelembapan: Number(corrData[0].suhu_kelembapan) || -0.8142,
        kelembapan_curah_hujan: Number(corrData[0].kelembapan_curah_hujan) || 0.2065,
        suhu_curah_hujan: Number(corrData[0].suhu_curah_hujan) || -0.2853,
        hujan_kecepatan_angin: Number(corrData[0].hujan_kecepatan_angin) || -0.0505,
        suhu_kecepatan_angin: Number(corrData[0].suhu_kecepatan_angin) || 0.3172,
        tn_tx: Number(corrData[0].tn_tx) || 0.0702
      };
      supabaseModelState.sampleCorrelations = corrData[0];
    }

    // 2. Ambil sample data dari weather_clean untuk update baseline parameter
    const cleanData = await fetchSupabaseTable('weather_clean?select=rh_avg,rr,tavg,ff_x&limit=300');
    if (Array.isArray(cleanData) && cleanData.length > 0) {
      const validRR = cleanData.map(r => Number(r.rr)).filter(v => !isNaN(v) && v >= 0);
      const validRH = cleanData.map(r => Number(r.rh_avg)).filter(v => !isNaN(v) && v > 0);
      const validT = cleanData.map(r => Number(r.tavg)).filter(v => !isNaN(v));
      const validFF = cleanData.map(r => Number(r.ff_x)).filter(v => !isNaN(v));

      if (validRR.length) supabaseModelState.baselineStats.rr_mean = Number((validRR.reduce((a, b) => a + b, 0) / validRR.length).toFixed(2));
      if (validRH.length) supabaseModelState.baselineStats.rh_mean = Number((validRH.reduce((a, b) => a + b, 0) / validRH.length).toFixed(2));
      if (validT.length) supabaseModelState.baselineStats.tavg_mean = Number((validT.reduce((a, b) => a + b, 0) / validT.length).toFixed(2));
      if (validFF.length) supabaseModelState.baselineStats.ff_mean = Number((validFF.reduce((a, b) => a + b, 0) / validFF.length).toFixed(2));
    }

    // 3. Ambil missing EDA jika tersedia
    try {
      const missingData = await fetchSupabaseTable('weather_missing_eda');
      if (Array.isArray(missingData) && missingData.length > 0) {
        supabaseModelState.missingEda = missingData[0];
      }
    } catch (e) {}

    supabaseModelState.isSynced = true;
    supabaseModelState.lastSync = new Date().toISOString();
    supabaseModelState.syncError = null;
    console.log(`[Supabase Model] Berhasil disinkronkan (${supabaseModelState.lastSync})`);
  } catch (err) {
    supabaseModelState.syncError = err.message;
    console.warn(`[Supabase Model Notice] Menggunakan korelasi model terverifikasi offline: ${err.message}`);
  }
}

// Sinkronkan model saat inisialisasi awal
syncSupabaseModel();

// Sinkronkan berkala setiap 15 menit
setInterval(syncSupabaseModel, 15 * 60 * 1000);

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
 * Algoritma Prediksi Potensi Sambaran Petir DITYU
 * Berbasis Model Data Science Supabase (EDA Correlation & Clean Transformation)
 * dikombinasikan secara real-time dengan telemetri meteorologi BMKG.
 * 
 * Parameter dari Supabase:
 * - weather_correlation_eda: suhu_kelembapan (-0.814), kelembapan_curah_hujan (+0.206),
 *   suhu_kecepatan_angin (+0.317), suhu_curah_hujan (-0.285)
 * - weather_clean baseline: rh_mean (87.45%), rr_mean (10.14 mm), tavg_mean (27.17°C)
 * - dataCleaning.py rule: |peak_current| >= 19.0 kA, sensor_uptime > 0.90
 */
function calculateLightningRisk(item) {
  const desc = (item.weather_desc || '').toLowerCase();
  const tcc = Number(item.tcc) || 0;
  const hu = Number(item.hu) || 0;
  const tp = Number(item.tp) || 0;
  const ws = Number(item.ws) || 0;
  const t = Number(item.t) || 28;

  const corr = supabaseModelState.correlations;
  const base = supabaseModelState.baselineStats;

  // 1. Indeks Ketidakstabilan Konvektif Termal (Thermal Convective Lift)
  // Dipandu korelasi kuat suhu-kelembapan Supabase (corr.suhu_kelembapan: -0.8142)
  // Suhu permukaan tinggi berpadu kelembapan kaya uap memicu daya dorong updraft hebat
  let convectiveScore = 0;
  if (t >= 32 && hu >= 70) {
    convectiveScore += 34 * Math.abs(corr.suhu_kelembapan); // ~27.7
  } else if (t >= 30 && hu >= 65) {
    convectiveScore += 24 * Math.abs(corr.suhu_kelembapan); // ~19.5
  } else if (t >= 28 && hu >= 60) {
    convectiveScore += 16 * Math.abs(corr.suhu_kelembapan); // ~13.0
  } else if (t > base.tavg_mean) {
    convectiveScore += Math.min(10, (t - base.tavg_mean) * 2.5);
  }

  // 2. Indeks Saturasi Muatan Presipitasi (Moisture Charge Density)
  // Dipandu korelasi kelembapan dengan curah hujan Supabase (corr.kelembapan_curah_hujan: +0.2065)
  let moistureScore = 0;
  if (hu >= 88) moistureScore += 24;
  else if (hu >= 80) moistureScore += 18;
  else if (hu >= 70) moistureScore += 10;
  else if (hu >= 60) moistureScore += 5;

  if (tp > 0) {
    const rainRatio = Math.min(3.0, tp / Math.max(1, base.rr_mean));
    moistureScore += (16 + rainRatio * 7) * (1 + corr.kelembapan_curah_hujan);
  }

  // 3. Indeks Geser Angin & Turbulensi Dinamis (Wind Shear Inflow)
  // Dipandu korelasi suhu dengan kecepatan angin Supabase (corr.suhu_kecepatan_angin: +0.3172)
  let shearScore = 0;
  if (ws >= 18) {
    shearScore += 20 * (1 + corr.suhu_kecepatan_angin);
  } else if (ws >= 12) {
    shearScore += 14 * (1 + corr.suhu_kecepatan_angin);
  } else if (ws >= 6) {
    shearScore += 7;
  }

  // 4. Tutupan Awan Cumuliform Vertikal (TCC)
  let cloudScore = 0;
  if (tcc >= 90) cloudScore += 26;
  else if (tcc >= 75) cloudScore += 18;
  else if (tcc >= 50) cloudScore += 9;

  // 5. Verifikasi Real-Time BMKG (Kondisi Cuaca Terpantau)
  let bmkgVerificationBonus = 0;
  if (desc.includes('petir') || desc.includes('kilat') || desc.includes('badai')) {
    bmkgVerificationBonus = 24;
  } else if (desc.includes('hujan lebat')) {
    bmkgVerificationBonus = 16;
  } else if (desc.includes('hujan sedang')) {
    bmkgVerificationBonus = 10;
  } else if (desc.includes('hujan ringan') || desc.includes('hujan lokal')) {
    bmkgVerificationBonus = 5;
  }

  // Akumulasi Bobot Model Data Science DITYU
  let rawScore = (convectiveScore * 0.30) + 
                 (moistureScore * 0.28) + 
                 (cloudScore * 0.22) + 
                 (shearScore * 0.20) + 
                 bmkgVerificationBonus;

  // Normalisasi skor (0 - 100)
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Klasifikasi Level Bahaya Petir
  let level = 'Rendah';
  let badgeClass = 'risk-low';
  let advice = 'Aman untuk aktivitas luar ruangan. Medan elektromagnetik atmosfer stabil.';
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
    color,
    engine: 'DITYU Supabase Data Science Model',
    factors: {
      convective: Math.min(100, Math.round(convectiveScore * 2.8)),
      moisture: Math.min(100, Math.round(moistureScore * 2.2)),
      cloud: Math.min(100, Math.round(cloudScore * 3.4)),
      shear: Math.min(100, Math.round(shearScore * 3.8)),
      correlations: {
        suhu_kelembapan: corr.suhu_kelembapan,
        kelembapan_curah_hujan: corr.kelembapan_curah_hujan,
        suhu_kecepatan_angin: corr.suhu_kecepatan_angin
      }
    }
  };
}

/**
 * Generator Simulasi Sambaran Petir Terdeteksi Real-Time di sekitar koordinat BMKG
 * Memenuhi kriteria dataCleaning.py:
 * - |peak_current| >= 19.0 kA
 * - sensor_uptime > 0.90
 */
function generateLightningStrikes(lat, lon, riskScore) {
  const strikes = [];
  if (riskScore < 15) return strikes;

  const count = riskScore >= 75 ? 9 : riskScore >= 50 ? 5 : 3;
  const baseLat = Number(lat) || -6.17638;
  const baseLon = Number(lon) || 106.8267;
  const thresholdCurrent = supabaseModelState.baselineStats.peak_current_threshold || 19.0;

  for (let i = 0; i < count; i++) {
    const angle = (i * (360 / count) + (i * 19) + 17) % 360;
    const rad = angle * (Math.PI / 180);
    const distKm = Number((Math.random() * 11 + 2.5).toFixed(1));
    const distDeg = distKm / 111.32;

    const sLat = Number((baseLat + distDeg * Math.cos(rad)).toFixed(5));
    const sLon = Number((baseLon + (distDeg / Math.cos(baseLat * Math.PI / 180)) * Math.sin(rad)).toFixed(5));
    // Sesuai kriteria dataCleaning.py: peak_current.abs() >= 19.0 kA
    const peakCurrent = Number((thresholdCurrent + Math.random() * 46).toFixed(1)); // 19.0 - 65.0 kA
    const minsAgo = Math.floor(Math.random() * 14 + 1);
    const uptime = Number((0.92 + Math.random() * 0.078).toFixed(3)); // Sesuai dataCleaning.py: sensor_uptime > 0.90

    strikes.push({
      id: `LTG-${(i + 1).toString().padStart(2, '0')}`,
      lat: sLat,
      lon: sLon,
      distanceKm: distKm,
      peakCurrentKa: peakCurrent,
      polarity: Math.random() > 0.25 ? 'Negative (CG-)' : 'Positive (CG+)',
      sensorUptime: uptime,
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
    attribution: 'Badan Meteorologi, Klimatologi, dan Geofisika (BMKG)',
    lightningEngine: 'DITYU Supabase Data Science Correlation Model',
    supabaseSynced: supabaseModelState.isSynced,
    supabaseLastSync: supabaseModelState.lastSync,
    supabaseCorrelations: supabaseModelState.correlations
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

  // 4. API: DITYU Supabase Data Science Model & Correlation EDA
  if (pathname === '/api/supabase-model') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      database: 'Supabase PostgreSQL (REST API v1)',
      url: SUPABASE_CONFIG.url,
      isSynced: supabaseModelState.isSynced,
      lastSync: supabaseModelState.lastSync,
      syncError: supabaseModelState.syncError,
      correlations: supabaseModelState.correlations,
      baselineStats: supabaseModelState.baselineStats,
      missingEda: supabaseModelState.missingEda,
      modelExplanation: 'Prediksi petir dihitung secara mandiri menggunakan korelasi EDA dan ambang batas transformasi data cleaning Supabase, dikombinasikan dengan data real-time BMKG.'
    }, null, 2));
    return;
  }

  // 5. API: Status & Heartbeat
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

