# ⚡ AetherSense — Sistem Prediksi Petir & Cuaca Real-Time BMKG

Aplikasi pemantauan cuaca dan prediksi potensi sambaran petir berbasis data terbuka resmi **Badan Meteorologi, Klimatologi, dan Geofisika (BMKG)**. Dirancang khusus untuk kebutuhan studi dan analisis Data Science dengan tampilan antarmuka yang elegan, berestetika tinggi (bespoke/artisan), serta tidak menggunakan template umum pasaran.

---

## 🌟 Fitur Utama

1. **Sinkronisasi Data Real-Time BMKG API**:
   - Terhubung langsung ke endpoint resmi BMKG: `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode}`.
   - Dilengkapi sistem *In-Memory Caching* (TTL 5 menit) untuk efisiensi koneksi dan mencegah *rate-limiting*.
   - Mekanisme **Resilient Fallback**: jika jaringan terputus atau API sedang offline, sistem secara otomatis beralih ke data cadangan lokal tanpa membuat layar menjadi kosong/error.
   - Live Countdown Auto-Sync (pembaruan otomatis tiap 60 detik) dan tombol pemicu pembaruan instan (*Manual Sync*).

2. **Algoritma Prediksi Potensi Petir (Data Science Model)**:
   - Menghitung **Indeks Potensi Sambaran Petir (0 - 100%)** berdasarkan dinamika parameter meteorologis:
     - Saturasi Kelembapan Relatif ($HU$)
     - Kepadatan Tutupan Awan Cumulonimbus ($TCC$)
     - Akumulasi Presipitasi Curah Hujan ($TP$)
     - Geser & Kecepatan Angin ($WS$)
     - Ketidakstabilan Konvektif Termal ($T$)
   - Visualisasi Radial Gauge interaktif dengan status peringatan:
     - 🟢 **Rendah (0–24%)** : Atmosfer stabil, aman untuk kegiatan luar.
     - 🟡 **Waspada (25–49%)**: Potensi konveksi lokal terbentuk.
     - 🟠 **Siaga (50–74%)**  : Awan konvektif pekat, peluang petir signifikan.
     - 🔴 **BAHAYA (75–100%)**: Badai petir aktif, peringatan bahaya keselamatan.

3. **GIS Google Maps, Radar Cuaca Real-Time & Prediksi Petir Spasial**:
   - Integrasi **Google Maps JavaScript API** dengan tema eksklusif *Dark Obsidian* yang terpadu dengan desain sistem.
   - **Pencarian Lokasi (Google Places Autocomplete)**: Pengguna dapat mencari nama jalan, fasilitas, atau wilayah mana pun di Indonesia dengan penghitungan jarak otomatis (rumus Haversine) ke stasiun BMKG terdekat.
   - **Layer Radar Doppler Real-Time**:
     - Menampilkan mosaik citra radar cuaca aktif (presipitasi hujan & pergerakan awan konvektif).
     - Fitur **Animasi Radar Playback**: Memutar pergerakan awan radar frame demi frame secara berulang, dilengkapi *scrubber slider* waktu dan kontrol opasitas.
     - Skala Reflektivitas Radar (**dBZ Legend**) untuk mengukur intensitas hujan dan resiko petir (5–55+ dBZ).
   - **Pemetaan Titik Sambaran Petir Aktif**:
     - Menandai titik sambaran petir di peta dengan ikon kilatan (⚡), arus puncak ($kA$), waktu sambaran, dan klasifikasi bahaya.
     - **Perimeter Zona Bahaya Konvektif**: Lingkaran radius inti bahaya ($5-10\text{ km}$) dan zona waspada ($15-25\text{ km}$) yang berubah warna secara dinamis mengikuti status peringatan petir.
     - Efek visual *animated radar sweep beam* berputar di atas stasiun observasi BMKG.

4. **Desain Antarmuka Eksklusif & Custom CSS**:
   - Tema *Deep Space Sapphire & Atmospheric Radar* dengan partikel atmosfer dinamis (HTML5 Canvas).
   - Glassmorphism presisi tinggi (`backdrop-filter: blur(24px)`), frosted borders, dan ambient glow.
   - Visualisasi kompas arah angin dengan jarum berputar otomatis sesuai derajat hembusan angin.
   - Jam digital presisi tinggi dengan zona waktu lokal (WIB).

5. **Multi-Wilayah Seluruh Indonesia**:
   - *Quick-Select Chips* untuk kota-kota besar: Gambir (Jakarta Pusat), Menteng, Senayan (Jakarta Selatan), Bandung, Surabaya, Yogyakarta, Denpasar (Bali), Medan, Makassar, Balikpapan.
   - Bilah pencarian kode wilayah ADM4 BMKG kustom untuk memeriksa kelurahan/kecamatan mana pun di Indonesia.

6. **Inspeksi Payload JSON Data Science**:
   - Laci inspeksi data interaktif untuk melihat dan menyalin raw JSON BMKG langsung dari browser.

---

## 🚀 Cara Menjalankan Aplikasi

Aplikasi dibangun menggunakan **Node.js native HTTP server**, sehingga **tidak memerlukan instalasi dependensi pihak ketiga (zero external npm dependencies)**. Anda dapat langsung menjalankannya!

### 1. Jalankan Server Backend

Buka terminal di direktori proyek ini (`c:\Kuliah\Data Science\Sistem Prediksi Petir`), lalu jalankan perintah:

```bash
node server.js
```

atau menggunakan npm:

```bash
npm start
```

### 2. Buka Aplikasi di Browser

Buka peramban (Chrome, Edge, Firefox) dan akses:

👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📁 Struktur Direktori

```
Sistem Prediksi Petir/
├── server.js               # Backend Node.js: Proxy API BMKG, Cache, Analisis Petir, Static File Server
├── package.json            # Konfigurasi npm script (start/dev)
├── README.md               # Dokumentasi sistem
├── public/                 # Frontend Web Client
│   ├── index.html          # Struktur UI Dashboard Observatori & Prediksi Petir
│   ├── css/
│   │   └── style.css       # Custom artisan CSS (Glassmorphism, Gauge, Responsive layout)
│   └── js/
│       └── app.js          # Real-time state, live countdown, SVG gauge renderer, particle canvas
└── data-cuaca/             # Arsip & Referensi Sumber Data BMKG
    ├── 31.71.01.1001.json  # Data sampel BMKG Gambir (Cadangan jika offline)
    ├── prakiraan-cuaca.php # Kode referensi BMKG awal
    └── README.md           # Petunjuk resmi portal BMKG
```

---

## 🌐 Endpoint API Backend

| Endpoint | Metode | Deskripsi |
| :--- | :---: | :--- |
| `/api/weather?adm4=31.71.01.1001` | `GET` | Mengambil prakiraan cuaca 3 hari BMKG + kalkulasi Indeks Risiko Petir & titik sambaran |
| `/api/radar-maps` | `GET` | Mengambil metadata tile radar Doppler real-time & time-series frame |
| `/api/regions` | `GET` | Daftar preset wilayah pilihan di Indonesia beserta kode adm4 |
| `/api/status` | `GET` | Informasi kesehatan server, cache, dan uptime |
| `/api/stream` | `GET` | Server-Sent Events (SSE) untuk heartbeat real-time |

---

## ⚖️ Atribusi & Lisensi Data

Data prakiraan cuaca ini bersumber langsung dari **Badan Meteorologi, Klimatologi, dan Geofisika (BMKG)** melalui portal resmi data terbuka [data.bmkg.go.id/prakiraan-cuaca](https://data.bmkg.go.id/prakiraan-cuaca).
Pencantuman identitas BMKG pada aplikasi ini adalah bagian dari kepatuhan terhadap lisensi data terbuka BMKG.

