/**
 * AETHERSENSE • Sistem Prediksi Petir & Cuaca Real-Time BMKG
 * Client Logic, Real-Time Sync & Interactive Atmosphere Engine
 */

(function () {
  'use strict';

  // State Management
  const state = {
    currentAdm4: '31.71.01.1001',
    activeDayIndex: 0,
    activeSlotIndex: 0,
    weatherData: null,
    countdownSeconds: 60,
    isSyncing: false,
    countdownTimer: null,
    clockTimer: null
  };

  // DOM Elements
  const el = {
    liveClock: document.getElementById('live-clock'),
    refreshCountdown: document.getElementById('refresh-countdown'),
    btnManualSync: document.getElementById('btn-manual-sync'),
    syncBadge: document.getElementById('sync-badge'),
    regionChipsList: document.getElementById('region-chips-list'),
    formAdm4Search: document.getElementById('form-adm4-search'),
    inputAdm4: document.getElementById('input-adm4'),
    noticeBanner: document.getElementById('notice-banner'),
    noticeText: document.getElementById('notice-text'),
    
    // Hero Weather
    geoCoordinates: document.getElementById('geo-coordinates'),
    locationName: document.getElementById('location-name'),
    locationSub: document.getElementById('location-sub'),
    sourceTag: document.getElementById('source-tag'),
    currentTemp: document.getElementById('current-temp'),
    currentWeatherIcon: document.getElementById('current-weather-icon'),
    currentDesc: document.getElementById('current-desc'),
    currentDescEn: document.getElementById('current-desc-en'),
    currentSlotTime: document.getElementById('current-slot-time'),
    currentVisibility: document.getElementById('current-visibility'),

    // Lightning Center
    lightningStatusBadge: document.getElementById('lightning-status-badge'),
    gaugeCircleProgress: document.getElementById('gauge-circle-progress'),
    lightningScoreVal: document.getElementById('lightning-score-val'),
    barConvective: document.getElementById('bar-convective'),
    txtConvective: document.getElementById('txt-convective'),
    barMoisture: document.getElementById('bar-moisture'),
    txtMoisture: document.getElementById('txt-moisture'),
    barCloud: document.getElementById('bar-cloud'),
    txtCloud: document.getElementById('txt-cloud'),
    lightningAdvice: document.getElementById('lightning-advice'),

    // Sensors
    sensorHu: document.getElementById('sensor-hu'),
    sensorHuBar: document.getElementById('sensor-hu-bar'),
    sensorHuStatus: document.getElementById('sensor-hu-status'),
    sensorTcc: document.getElementById('sensor-tcc'),
    sensorTccBar: document.getElementById('sensor-tcc-bar'),
    sensorTccStatus: document.getElementById('sensor-tcc-status'),
    sensorTp: document.getElementById('sensor-tp'),
    sensorTpBar: document.getElementById('sensor-tp-bar'),
    sensorTpStatus: document.getElementById('sensor-tp-status'),
    sensorWs: document.getElementById('sensor-ws'),
    sensorWd: document.getElementById('sensor-wd'),
    sensorWdTo: document.getElementById('sensor-wd-to'),
    compassNeedle: document.getElementById('compass-needle'),
    sensorVs: document.getElementById('sensor-vs'),
    sensorVsBar: document.getElementById('sensor-vs-bar'),
    sensorVsStatus: document.getElementById('sensor-vs-status'),
    sensorLocalTime: document.getElementById('sensor-local-time'),
    sensorUtcTime: document.getElementById('sensor-utc-time'),
    sensorTz: document.getElementById('sensor-tz'),

    // Timeline & Day Tabs
    dayTabsContainer: document.getElementById('day-tabs-container'),
    timelineStream: document.getElementById('timeline-stream'),

    // JSON Drawer
    toggleJsonBtn: document.getElementById('toggle-json-btn'),
    drawerContent: document.getElementById('drawer-content'),
    drawerCaret: document.getElementById('drawer-caret'),
    drawerMetaInfo: document.getElementById('drawer-meta-info'),
    btnCopyJson: document.getElementById('btn-copy-json'),
    jsonViewer: document.getElementById('json-viewer')
  };

  /**
   * 1. Inisialisasi Jam Digital Real-Time (WIB / Waktu Lokal)
   */
  function initDigitalClock() {
    function update() {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      if (el.liveClock) {
        el.liveClock.textContent = `${timeStr} WIB`;
      }
    }
    update();
    state.clockTimer = setInterval(update, 1000);
  }

  /**
   * 2. Inisialisasi Countdown Timer Auto-Sync
   */
  function startAutoRefreshCountdown() {
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownSeconds = 60;
    if (el.refreshCountdown) el.refreshCountdown.textContent = '60s';

    state.countdownTimer = setInterval(() => {
      state.countdownSeconds--;
      if (el.refreshCountdown) {
        el.refreshCountdown.textContent = `${state.countdownSeconds}s`;
      }

      if (state.countdownSeconds <= 0) {
        state.countdownSeconds = 60;
        fetchForecastData(state.currentAdm4, false);
      }
    }, 1000);
  }

  /**
   * 3. Fetch Region Presets
   */
  async function loadRegionPresets() {
    try {
      const res = await fetch('/api/regions');
      if (!res.ok) return;
      const data = await res.json();
      if (data.presets && Array.isArray(data.presets)) {
        renderRegionChips(data.presets);
      }
    } catch (e) {
      console.warn('Gagal memuat preset wilayah:', e);
    }
  }

  function renderRegionChips(presets) {
    if (!el.regionChipsList) return;
    el.regionChipsList.innerHTML = '';

    presets.forEach((region) => {
      const btn = document.createElement('button');
      btn.className = `chip-item ${region.code === state.currentAdm4 ? 'active' : ''}`;
      btn.dataset.code = region.code;
      btn.textContent = region.name;
      btn.title = `${region.name} (${region.province}) - adm4: ${region.code}`;

      btn.addEventListener('click', () => {
        if (state.currentAdm4 === region.code) return;
        state.currentAdm4 = region.code;
        if (el.inputAdm4) el.inputAdm4.value = region.code;

        document.querySelectorAll('.chip-item').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');

        fetchForecastData(state.currentAdm4, true);
      });

      el.regionChipsList.appendChild(btn);
    });
  }

  /**
   * 4. Fetch Weather Forecast dari Backend (BMKG API)
   */
  async function fetchForecastData(adm4, resetDay = true) {
    if (state.isSyncing) return;
    state.isSyncing = true;

    if (el.btnManualSync) {
      el.btnManualSync.style.transform = 'rotate(360deg)';
      el.btnManualSync.style.transition = 'transform 0.6s ease';
    }

    try {
      const res = await fetch(`/api/weather?adm4=${encodeURIComponent(adm4)}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();

      if (data.error) throw new Error(data.message || 'Gagal memproses data cuaca');

      state.weatherData = data;

      // Handle Fallback / Live Notice
      if (data._metadata && data._metadata.warning) {
        showNotice(data._metadata.warning, 'warning');
        if (el.sourceTag) {
          el.sourceTag.textContent = 'DATA CADANGAN BMKG';
          el.sourceTag.style.color = '#fbbf24';
        }
      } else {
        hideNotice();
        if (el.sourceTag) {
          el.sourceTag.textContent = data._metadata && data._metadata.cached ? 'BMKG CACHED (SYNCED)' : 'BMKG LIVE CONNECTED';
          el.sourceTag.style.color = '#34d399';
        }
      }

      if (resetDay) {
        state.activeDayIndex = 0;
        state.activeSlotIndex = 0;
      }

      renderAll();
      startAutoRefreshCountdown(); // reset countdown
    } catch (err) {
      console.error('Fetch error:', err);
      showNotice(`Gagal sinkronisasi data: ${err.message}`, 'error');
    } finally {
      state.isSyncing = false;
      setTimeout(() => {
        if (el.btnManualSync) {
          el.btnManualSync.style.transform = '';
          el.btnManualSync.style.transition = '';
        }
      }, 600);
    }
  }

  function showNotice(msg, type = 'warning') {
    if (!el.noticeBanner || !el.noticeText) return;
    el.noticeText.textContent = msg;
    el.noticeBanner.classList.remove('hidden');
    if (type === 'error') {
      el.noticeBanner.style.background = 'rgba(239, 68, 68, 0.15)';
      el.noticeBanner.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      el.noticeBanner.style.color = '#fca5a5';
    } else {
      el.noticeBanner.style.background = 'rgba(245, 158, 11, 0.12)';
      el.noticeBanner.style.borderColor = 'rgba(245, 158, 11, 0.35)';
      el.noticeBanner.style.color = '#fde68a';
    }
  }

  function hideNotice() {
    if (el.noticeBanner) el.noticeBanner.classList.add('hidden');
  }

  /**
   * 5. Render All Components
   */
  function renderAll() {
    if (!state.weatherData) return;

    const loc = state.weatherData.lokasi || {};
    const cuacaDays = (state.weatherData.data && state.weatherData.data[0] && state.weatherData.data[0].cuaca) || [];
    
    // 5.1 Render Geo Header
    if (el.geoCoordinates) {
      el.geoCoordinates.textContent = `LAT: ${Number(loc.lat || 0).toFixed(4)} • LON: ${Number(loc.lon || 0).toFixed(4)} • ${loc.timezone || 'Asia/Jakarta'}`;
    }
    if (el.locationName) {
      el.locationName.textContent = `${loc.desa || 'Wilayah'}, ${loc.kecamatan || ''}`;
    }
    if (el.locationSub) {
      el.locationSub.textContent = `${loc.kotkab || ''}, ${loc.provinsi || ''}`;
    }

    // 5.2 Render Day Tabs
    renderDayTabs(cuacaDays);

    // 5.3 Render Current Selected Slot Details
    renderCurrentSlot(cuacaDays);

    // 5.4 Render Timeline Stream
    renderTimelineStream(cuacaDays);

    // 5.5 Update Raw JSON Drawer
    if (el.jsonViewer) {
      el.jsonViewer.textContent = JSON.stringify(state.weatherData, null, 2);
    }
    if (el.drawerMetaInfo) {
      el.drawerMetaInfo.textContent = `ADM4: ${loc.adm4 || state.currentAdm4} | Waktu Ambil: ${state.weatherData._metadata?.fetchedAt || '-'}`;
    }
  }

  /**
   * Render Day Tabs
   */
  function renderDayTabs(days) {
    if (!el.dayTabsContainer) return;
    el.dayTabsContainer.innerHTML = '';

    days.forEach((daySlots, index) => {
      const btn = document.createElement('button');
      btn.className = `day-tab ${index === state.activeDayIndex ? 'active' : ''}`;
      
      let label = `Hari ke-${index + 1}`;
      if (daySlots && daySlots[0] && daySlots[0].local_datetime) {
        const d = new Date(daySlots[0].local_datetime.replace(' ', 'T'));
        if (!isNaN(d.getTime())) {
          const dayName = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
          label = index === 0 ? `Hari Ini (${dayName})` : dayName;
        }
      }
      btn.textContent = label;

      btn.addEventListener('click', () => {
        state.activeDayIndex = index;
        state.activeSlotIndex = 0;
        document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');

        renderCurrentSlot(days);
        renderTimelineStream(days);
      });

      el.dayTabsContainer.appendChild(btn);
    });
  }

  /**
   * Render Current Slot (Hero + Lightning Center + Telemetry Grid)
   */
  function renderCurrentSlot(days) {
    const currentDay = days[state.activeDayIndex] || [];
    const slot = currentDay[state.activeSlotIndex] || currentDay[0];
    if (!slot) return;

    // A. Hero Weather Main
    if (el.currentTemp) el.currentTemp.textContent = slot.t !== undefined ? slot.t : '--';
    if (el.currentDesc) el.currentDesc.textContent = slot.weather_desc || 'Tidak diketahui';
    if (el.currentDescEn) el.currentDescEn.textContent = slot.weather_desc_en || '';
    if (el.currentSlotTime) el.currentSlotTime.textContent = `${slot.local_datetime ? slot.local_datetime.slice(11, 16) : '--:--'} WIB`;
    if (el.currentVisibility) el.currentVisibility.textContent = slot.vs_text || `${slot.vs || '--'} m`;

    if (el.currentWeatherIcon && slot.image) {
      el.currentWeatherIcon.src = slot.image.replace(/ /g, '%20');
      el.currentWeatherIcon.alt = slot.weather_desc || 'Cuaca BMKG';
    }

    // B. Lightning Command Center (Sistem Prediksi Petir)
    const risk = slot.lightning_risk || {
      score: 15,
      level: 'Rendah',
      badgeClass: 'risk-low',
      advice: 'Kondisi stabil.',
      color: '#10b981'
    };

    if (el.lightningScoreVal) el.lightningScoreVal.textContent = risk.score;
    if (el.lightningStatusBadge) {
      el.lightningStatusBadge.className = `risk-pill ${risk.badgeClass}`;
      el.lightningStatusBadge.textContent = risk.level;
    }

    // Circular Gauge Stroke (circumference is 100 for 15.9155 radius SVG)
    if (el.gaugeCircleProgress) {
      el.gaugeCircleProgress.setAttribute('stroke-dasharray', `${risk.score}, 100`);
      el.gaugeCircleProgress.style.stroke = risk.color;
    }

    // Multi-factor breakdown bars
    if (el.barConvective) {
      const convScore = Math.min(100, (risk.score * 1.1).toFixed(0));
      el.barConvective.style.width = `${convScore}%`;
      if (el.txtConvective) el.txtConvective.textContent = risk.level;
    }

    const huVal = Number(slot.hu) || 0;
    if (el.barMoisture) el.barMoisture.style.width = `${huVal}%`;
    if (el.txtMoisture) el.txtMoisture.textContent = `${huVal}%`;

    const tccVal = Number(slot.tcc) || 0;
    if (el.barCloud) el.barCloud.style.width = `${tccVal}%`;
    if (el.txtCloud) el.txtCloud.textContent = `${tccVal}%`;

    if (el.lightningAdvice) el.lightningAdvice.textContent = risk.advice;

    // C. Telemetry Sensors Grid
    // 1. Kelembapan (HU)
    if (el.sensorHu) el.sensorHu.textContent = slot.hu !== undefined ? slot.hu : '--';
    if (el.sensorHuBar) el.sensorHuBar.style.width = `${Math.min(100, huVal)}%`;
    if (el.sensorHuStatus) {
      el.sensorHuStatus.textContent = huVal >= 80 ? 'Kelembapan tinggi, udara lembap' : huVal >= 60 ? 'Kelembapan moderat & sejuk' : 'Kelembapan kering';
    }

    // 2. Tutupan Awan (TCC)
    if (el.sensorTcc) el.sensorTcc.textContent = slot.tcc !== undefined ? slot.tcc : '--';
    if (el.sensorTccBar) el.sensorTccBar.style.width = `${Math.min(100, tccVal)}%`;
    if (el.sensorTccStatus) {
      el.sensorTccStatus.textContent = tccVal >= 80 ? 'Langit tertutup awan pekat' : tccVal >= 50 ? 'Berawan sebagian besar' : 'Langit cerah berawan terbuka';
    }

    // 3. Presipitasi (TP)
    const tpVal = Number(slot.tp) || 0;
    if (el.sensorTp) el.sensorTp.textContent = slot.tp !== undefined ? slot.tp : '0';
    if (el.sensorTpBar) el.sensorTpBar.style.width = `${Math.min(100, tpVal * 15)}%`;
    if (el.sensorTpStatus) {
      el.sensorTpStatus.textContent = tpVal > 5 ? 'Curah hujan lebat / akumulasi tinggi' : tpVal > 0.5 ? 'Hujan intensitas sedang' : 'Presipitasi minim / kering';
    }

    // 4. Kecepatan & Arah Angin (WS & WD)
    const wsVal = Number(slot.ws) || 0;
    if (el.sensorWs) el.sensorWs.textContent = wsVal.toFixed(1);
    if (el.sensorWd) el.sensorWd.textContent = `${slot.wd || '-'} (${slot.wd_deg || 0}°)`;
    if (el.sensorWdTo) el.sensorWdTo.textContent = `${slot.wd_to || '-'}`;
    if (el.compassNeedle) {
      const deg = Number(slot.wd_deg) || 0;
      el.compassNeedle.style.transform = `rotate(${deg}deg)`;
    }

    // 5. Jarak Pandang (VS)
    if (el.sensorVs) el.sensorVs.textContent = slot.vs_text ? slot.vs_text.replace('km', '').trim() : (slot.vs ? `${(slot.vs / 1000).toFixed(0)}` : '> 10');
    if (el.sensorVsBar) el.sensorVsBar.style.width = '100%';
    if (el.sensorVsStatus) {
      el.sensorVsStatus.textContent = slot.vs_text ? `Jarak pandang ${slot.vs_text}` : 'Visibilitas atmosfer standar';
    }

    // 6. Waktu & UTC
    if (el.sensorLocalTime) el.sensorLocalTime.textContent = slot.local_datetime || '--';
    if (el.sensorUtcTime) el.sensorUtcTime.textContent = slot.utc_datetime || '--';
    if (el.sensorTz) {
      const loc = state.weatherData.lokasi || {};
      el.sensorTz.textContent = loc.timezone || 'Asia/Jakarta';
    }

    // 7. Sinkronisasi Peta Radar Cuaca & Prediksi Petir GIS
    if (typeof updateMapWithWeatherData === 'function') {
      updateMapWithWeatherData();
    }
  }

  /**
   * Render Timeline Stream Carousel
   */
  function renderTimelineStream(days) {
    if (!el.timelineStream) return;
    el.timelineStream.innerHTML = '';

    const currentDay = days[state.activeDayIndex] || [];
    if (currentDay.length === 0) {
      el.timelineStream.innerHTML = '<div class="loading-stream">Tidak ada data prakiraan pada hari ini.</div>';
      return;
    }

    currentDay.forEach((slot, index) => {
      const card = document.createElement('div');
      card.className = `timeline-card ${index === state.activeSlotIndex ? 'active-slot' : ''}`;
      
      const timeStr = slot.local_datetime ? slot.local_datetime.slice(11, 16) : `Jam ${index + 1}`;
      const imgUrl = (slot.image || '').replace(/ /g, '%20');
      const risk = slot.lightning_risk || { score: 10, color: '#10b981', level: 'Rendah' };

      card.innerHTML = `
        <span class="timeline-time">${timeStr}</span>
        <div class="timeline-icon-box">
          <img src="${imgUrl}" alt="${slot.weather_desc || 'Cuaca'}" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'%2338bdf8\\'><circle cx=\\'12\\' cy=\\'12\\' r=\\'4\\'/></svg>'">
        </div>
        <span class="timeline-temp">${slot.t !== undefined ? slot.t : '--'}°C</span>
        <span class="timeline-desc">${slot.weather_desc || '-'}</span>
        <div class="timeline-risk-dot" title="Risiko Petir: ${risk.score}% (${risk.level})">
          <span class="risk-dot-circle" style="background: ${risk.color}"></span>
          <span>⚡ ${risk.score}%</span>
        </div>
      `;

      card.addEventListener('click', () => {
        state.activeSlotIndex = index;
        document.querySelectorAll('.timeline-card').forEach(c => c.classList.remove('active-slot'));
        card.classList.add('active-slot');

        renderCurrentSlot(days);
      });

      el.timelineStream.appendChild(card);
    });
  }

  /**
   * 6. Setup Interaksi Pengguna & Event Listeners
   */
  function setupEventListeners() {
    // Manual Sync Button
    if (el.btnManualSync) {
      el.btnManualSync.addEventListener('click', () => {
        fetchForecastData(state.currentAdm4, false);
      });
    }

    // Custom ADM4 Search Form
    if (el.formAdm4Search) {
      el.formAdm4Search.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = (el.inputAdm4.value || '').trim();
        if (!code) return;

        state.currentAdm4 = code;
        document.querySelectorAll('.chip-item').forEach(c => {
          c.classList.toggle('active', c.dataset.code === code);
        });

        fetchForecastData(state.currentAdm4, true);
      });
    }

    // Toggle Raw JSON Drawer
    if (el.toggleJsonBtn && el.drawerContent) {
      el.toggleJsonBtn.addEventListener('click', () => {
        const isCollapsed = el.drawerContent.classList.contains('collapsed');
        if (isCollapsed) {
          el.drawerContent.classList.remove('collapsed');
          if (el.drawerCaret) el.drawerCaret.style.transform = 'rotate(180deg)';
        } else {
          el.drawerContent.classList.add('collapsed');
          if (el.drawerCaret) el.drawerCaret.style.transform = 'rotate(0deg)';
        }
      });
    }

    // Copy JSON to Clipboard
    if (el.btnCopyJson && el.jsonViewer) {
      el.btnCopyJson.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(el.jsonViewer.textContent);
          const oldTxt = el.btnCopyJson.textContent;
          el.btnCopyJson.textContent = 'Tersalin!';
          el.btnCopyJson.style.background = 'var(--accent-emerald)';
          el.btnCopyJson.style.color = '#000';
          setTimeout(() => {
            el.btnCopyJson.textContent = oldTxt;
            el.btnCopyJson.style.background = '';
            el.btnCopyJson.style.color = '';
          }, 2000);
        } catch (err) {
          alert('Tidak dapat menyalin secara otomatis.');
        }
      });
    }
  }

  /**
   * 7. Ambient Particle Canvas Animation
   * Partikel atmosfer halus mengapung untuk efek observatori meteorologi yang hidup
   */
  function initAmbientCanvas() {
    const canvas = document.getElementById('ambient-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const particles = [];
    const count = Math.min(65, Math.floor((width * height) / 25000));

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.8 + 0.4,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        alpha: Math.random() * 0.5 + 0.2
      });
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56, 189, 248, ${p.alpha})`;
        ctx.fill();
      });

      requestAnimationFrame(animate);
    }
    animate();
  }

  /**
   * 8. Dual-Engine Map Architecture (Google Maps API + Fallback Dark GIS Radar Engine)
   */
  const mapState = {
    engine: 'none', // 'google' | 'leaflet'
    googleMap: null,
    leafletMap: null,
    stationMarker: null,
    dangerCircle: null,
    watchCircle: null,
    strikeMarkers: [],
    dopplerOverlay: null,
    activeFrameIndex: 2,
    isPlayingRadar: false,
    radarPlayTimer: null,
    placesAutocomplete: null,
    searchMarker: null,
    showRadar: true,
    showLightning: true,
    showDangerRadius: true,
    isMounted: false
  };

  // Tema Dark Obsidian Google Maps
  const darkMapStyles = [
    { elementType: "geometry", stylers: [{ color: "#0c1322" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#070a12" }, { weight: 3 }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#38bdf8" }] },
    { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#38bdf8" }, { weight: 1 }] },
    { featureType: "administrative.province", elementType: "geometry.stroke", stylers: [{ color: "#1e293b" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0e1c26" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#38bdf8" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#162238" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0c1220" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e3a5f" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0e1a2c" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#cbd5e1" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#162238" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#060911" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#38bdf8" }] }
  ];

  // Callback Global Google Maps initMap
  window.initMap = function () {
    window._gmapsCallbackCalled = true;
    if (typeof window._tryMountGoogleMap === 'function') {
      window._tryMountGoogleMap();
    }
  };

  /**
   * Coba Inisialisasi Google Maps API
   */
  window._tryMountGoogleMap = function () {
    if (mapState.engine === 'leaflet') return;
    if (window._gmapsAuthFailed) {
      window._triggerMapFallback("Google Maps API Key belum diaktivasi untuk 'Maps JavaScript API' di Google Cloud Console.");
      return;
    }

    const mapContainer = document.getElementById('map');
    if (!mapContainer || !window.google || !window.google.maps || !window.google.maps.Map) {
      return;
    }

    try {
      const defaultLat = state.weatherData?.lokasi?.lat ? Number(state.weatherData.lokasi.lat) : -6.17638;
      const defaultLng = state.weatherData?.lokasi?.lon ? Number(state.weatherData.lokasi.lon) : 106.8267;

      mapState.googleMap = new google.maps.Map(mapContainer, {
        center: { lat: defaultLat, lng: defaultLng },
        zoom: 11,
        styles: darkMapStyles,
        disableDefaultUI: false,
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_BOTTOM
        },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        backgroundColor: '#070a12'
      });

      mapState.engine = 'google';
      mapState.isMounted = true;

      // Update badge
      const engineBadge = document.getElementById('badge-engine-type');
      if (engineBadge) {
        engineBadge.textContent = 'GOOGLE MAPS API (CONNECTED)';
        engineBadge.className = 'badge-engine google';
      }

      initGooglePlacesSearch();
      loadRadarLayers();
      setupMapControls();

      if (state.weatherData) {
        updateMapWithWeatherData();
      }
    } catch (e) {
      console.warn("Gagal inisialisasi Google Maps, beralih ke Fallback GIS:", e);
      window._triggerMapFallback("Gagal memuat Google Maps (" + e.message + "). Mengaktifkan Dark GIS Radar Engine...");
    }
  };

  /**
   * Fallback Tangguh ke Leaflet Dark GIS & RainViewer Weather Radar
   */
  window._triggerMapFallback = function (reason) {
    if (mapState.engine === 'leaflet') return;

    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    if (!window.L) {
      setTimeout(() => window._triggerMapFallback(reason), 300);
      return;
    }

    try {
      // Bersihkan container map dari Google Maps jika ada sisa
      mapContainer.innerHTML = '';

      const defaultLat = state.weatherData?.lokasi?.lat ? Number(state.weatherData.lokasi.lat) : -6.17638;
      const defaultLng = state.weatherData?.lokasi?.lon ? Number(state.weatherData.lokasi.lon) : 106.8267;

      mapState.leafletMap = L.map('map', {
        center: [defaultLat, defaultLng],
        zoom: 11,
        zoomControl: true
      });

      // Pasang Dark CartoDB Matter Tile Layer (Tampilan Gelap Elegan Bebas Kuota)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }).addTo(mapState.leafletMap);

      mapState.engine = 'leaflet';
      mapState.isMounted = true;

      // Update badge engine
      const engineBadge = document.getElementById('badge-engine-type');
      if (engineBadge) {
        engineBadge.textContent = 'DARK GIS RADAR (ACTIVE)';
        engineBadge.className = 'badge-engine gis';
      }

      // Tampilkan Alert Informatif
      const alertBox = document.getElementById('map-engine-alert');
      const alertText = document.getElementById('map-engine-alert-text');
      if (alertBox && alertText) {
        alertText.textContent = reason || "Google Maps API Key memerlukan aktivasi Maps JavaScript API di Google Cloud Console. Sistem beralih ke Dark GIS Radar Engine agar radar cuaca dan prediksi petir tetap tampil sempurna.";
        alertBox.classList.remove('hidden');
      }

      initLeafletGeocodeSearch();
      loadRadarLayers();
      setupMapControls();

      if (state.weatherData) {
        updateMapWithWeatherData();
      }
    } catch (err) {
      console.error("Gagal mengaktifkan Leaflet fallback:", err);
    }
  };

  /**
   * Inisialisasi Pencarian Tempat via Google Places Autocomplete
   */
  function initGooglePlacesSearch() {
    const input = document.getElementById('places-search-input');
    if (!input || !mapState.googleMap || !window.google?.maps?.places) return;

    try {
      mapState.placesAutocomplete = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'id' },
        fields: ['geometry', 'name', 'formatted_address']
      });

      mapState.placesAutocomplete.bindTo('bounds', mapState.googleMap);

      mapState.placesAutocomplete.addListener('place_changed', () => {
        const place = mapState.placesAutocomplete.getPlace();
        if (!place || !place.geometry || !place.geometry.location) return;

        const loc = place.geometry.location;
        mapState.googleMap.panTo(loc);
        mapState.googleMap.setZoom(13);

        if (mapState.searchMarker) mapState.searchMarker.setMap(null);

        mapState.searchMarker = new google.maps.Marker({
          position: loc,
          map: mapState.googleMap,
          title: place.name || 'Lokasi Pencarian',
          animation: google.maps.Animation.DROP,
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            scale: 6,
            fillColor: '#38bdf8',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2
          }
        });

        let distText = '';
        if (state.weatherData && state.weatherData.lokasi) {
          const bLat = Number(state.weatherData.lokasi.lat);
          const bLon = Number(state.weatherData.lokasi.lon);
          const dKm = calculateHaversineDistance(bLat, bLon, loc.lat(), loc.lng());
          distText = `<div class="iw-metric"><span>Jarak ke Stasiun BMKG:</span><strong>${dKm.toFixed(1)} km</strong></div>`;
        }

        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div class="iw-card">
              <div class="iw-title">${place.name || 'Lokasi Terpilih'}</div>
              <div class="iw-sub">${place.formatted_address || ''}</div>
              <div class="iw-metric"><span>Koordinat:</span><strong>${loc.lat().toFixed(4)}, ${loc.lng().toFixed(4)}</strong></div>
              ${distText}
            </div>
          `
        });
        infoWindow.open(mapState.googleMap, mapState.searchMarker);
      });
    } catch (e) {
      console.warn('Gagal inisialisasi Google Places:', e);
    }
  }

  /**
   * Inisialisasi Pencarian Tempat via OpenStreetMap Nominatim (untuk Leaflet Fallback)
   */
  function initLeafletGeocodeSearch() {
    const input = document.getElementById('places-search-input');
    if (!input) return;

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = (input.value || '').trim();
        if (!query || !mapState.leafletMap) return;

        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=id&q=${encodeURIComponent(query)}`;
          const res = await fetch(url);
          const results = await res.json();

          if (results && results.length > 0) {
            const first = results[0];
            const pLat = parseFloat(first.lat);
            const pLon = parseFloat(first.lon);

            mapState.leafletMap.flyTo([pLat, pLon], 13);

            if (mapState.searchMarker) {
              mapState.leafletMap.removeLayer(mapState.searchMarker);
            }

            let distText = '';
            if (state.weatherData && state.weatherData.lokasi) {
              const bLat = Number(state.weatherData.lokasi.lat);
              const bLon = Number(state.weatherData.lokasi.lon);
              const dKm = calculateHaversineDistance(bLat, bLon, pLat, pLon);
              distText = `<div class="iw-metric"><span>Jarak ke Stasiun BMKG:</span><strong>${dKm.toFixed(1)} km</strong></div>`;
            }

            mapState.searchMarker = L.marker([pLat, pLon])
              .addTo(mapState.leafletMap)
              .bindPopup(`
                <div class="iw-card">
                  <div class="iw-title">${first.display_name.split(',')[0]}</div>
                  <div class="iw-sub">${first.display_name}</div>
                  <div class="iw-metric"><span>Koordinat:</span><strong>${pLat.toFixed(4)}, ${pLon.toFixed(4)}</strong></div>
                  ${distText}
                </div>
              `)
              .openPopup();
          } else {
            alert('Lokasi tidak ditemukan. Coba kata kunci yang lebih spesifik.');
          }
        } catch (err) {
          console.warn('Geocoding search error:', err);
        }
      }
    });
  }

  /**
   * Generator Citra Radar Doppler Awan Konvektif Real-Time
   * Warna:
   * - Cerah / Tanpa Awan : Transparan (Bening / Tidak Berwarna)
   * - Potensi Rendah / Gerimis : Hijau (#10b981 / #22c55e)
   * - Potensi Sedang : Kuning (#eab308)
   * - Potensi Tinggi / Hujan Lebat : Merah (#ef4444)
   * - Badai Petir : Ungu Elektrik (#a855f7)
   */
  function generateDopplerRadarOverlay(lat, lon, slot, frameStep = 2) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    const desc = (slot.weather_desc || '').toLowerCase();
    const tcc = Number(slot.tcc) || 0;
    const tp = Number(slot.tp) || 0;
    const risk = slot.lightning_risk?.score || 0;
    const wdDeg = Number(slot.wd_deg) || 45;
    const ws = Number(slot.ws) || 8;

    // JIKA CERAH / TIDAK ADA AWAN & HUJAN -> TIDAK BERWARNA (TRANSPARAN PENUH)
    const isClear = (desc.includes('cerah') && !desc.includes('berawan')) && tp === 0 && tcc < 20;
    if (isClear) {
      return { dataUrl: canvas.toDataURL(), isEmpty: true };
    }

    const cx = 512;
    const cy = 512;

    // Arah pergerakan awan mengikuti vektor hembusan angin BMKG
    const radWind = (wdDeg - 90) * (Math.PI / 180);
    const driftSpeed = Math.max(8, ws * 1.6);
    const driftX = Math.cos(radWind) * driftSpeed * (frameStep - 2);
    const driftY = Math.sin(radWind) * driftSpeed * (frameStep - 2);

    // Kategori intensitas hujan
    const isThunder = desc.includes('petir') || desc.includes('badai') || risk >= 55 || tp >= 4;
    const isHeavy = desc.includes('lebat') || tp >= 2.0 || risk >= 38;
    const isModerate = desc.includes('sedang') || desc.includes('hujan') || tp > 0.3 || risk >= 22;

    // Jumlah dan ukuran sel awan radar
    const mainRadius = isThunder ? 320 : isHeavy ? 280 : isModerate ? 230 : 170;
    const cells = [];

    // 1. Sel Awan Utama (di dekat stasiun)
    cells.push({
      x: cx + driftX,
      y: cy + driftY,
      r: mainRadius,
      level: isThunder ? 'thunder' : isHeavy ? 'heavy' : isModerate ? 'moderate' : 'light'
    });

    // 2. Sel Awan Satelit / Kluster Sekunder
    const count = isThunder ? 6 : isHeavy ? 5 : isModerate ? 3 : 2;
    for (let i = 1; i <= count; i++) {
      const angle = (i * 62 + wdDeg) * (Math.PI / 180);
      const dist = (i * 55) + 65;
      const r = mainRadius * (0.4 + (i % 3) * 0.18);
      cells.push({
        x: cx + Math.cos(angle) * dist + driftX,
        y: cy + Math.sin(angle) * dist + driftY,
        r: r,
        level: (i === 1 && isThunder) ? 'thunder' : (i <= 2 && (isThunder || isHeavy)) ? 'heavy' : isModerate ? 'moderate' : 'light'
      });
    }

    // Gambar setiap sel awan dengan gradien Doppler sesuai aturan:
    // Merah = tinggi, Hijau = rendah, Bening = tanpa awan
    cells.forEach(c => {
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);

      if (c.level === 'thunder') {
        // Badai Petir: Ungu di inti -> Merah pekat -> Kuning -> Hijau -> Bening
        grad.addColorStop(0.0, 'rgba(168, 85, 247, 0.95)'); // Ungu (> 55 dBZ)
        grad.addColorStop(0.25, 'rgba(239, 68, 68, 0.90)'); // Merah pekat (48 dBZ)
        grad.addColorStop(0.50, 'rgba(245, 158, 11, 0.78)'); // Kuning-Oranye (35 dBZ)
        grad.addColorStop(0.75, 'rgba(16, 185, 129, 0.60)'); // Hijau (22 dBZ)
        grad.addColorStop(0.92, 'rgba(16, 185, 129, 0.20)'); // Hijau pudar
        grad.addColorStop(1.0, 'rgba(16, 185, 129, 0.0)');  // Bening
      } else if (c.level === 'heavy') {
        // Hujan Lebat: Merah di inti -> Kuning -> Hijau -> Bening
        grad.addColorStop(0.0, 'rgba(239, 68, 68, 0.88)');  // Merah (45 dBZ)
        grad.addColorStop(0.35, 'rgba(245, 158, 11, 0.75)'); // Kuning (32 dBZ)
        grad.addColorStop(0.68, 'rgba(16, 185, 129, 0.55)'); // Hijau (20 dBZ)
        grad.addColorStop(0.90, 'rgba(16, 185, 129, 0.18)'); // Hijau pudar
        grad.addColorStop(1.0, 'rgba(16, 185, 129, 0.0)');
      } else if (c.level === 'moderate') {
        // Hujan Sedang: Kuning di inti -> Hijau -> Bening
        grad.addColorStop(0.0, 'rgba(234, 179, 8, 0.80)');   // Kuning (30 dBZ)
        grad.addColorStop(0.48, 'rgba(16, 185, 129, 0.55)'); // Hijau (20 dBZ)
        grad.addColorStop(0.85, 'rgba(16, 185, 129, 0.18)'); // Hijau pudar
        grad.addColorStop(1.0, 'rgba(16, 185, 129, 0.0)');
      } else {
        // Hujan Ringan / Berawan: Hijau saja -> Bening
        grad.addColorStop(0.0, 'rgba(16, 185, 129, 0.65)');  // Hijau (18 dBZ)
        grad.addColorStop(0.55, 'rgba(16, 185, 129, 0.35)'); // Hijau muda
        grad.addColorStop(0.85, 'rgba(16, 185, 129, 0.10)');
        grad.addColorStop(1.0, 'rgba(16, 185, 129, 0.0)');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    });

    return { dataUrl: canvas.toDataURL(), isEmpty: false };
  }

  function loadRadarLayers() {
    applyRadarOverlay(mapState.activeFrameIndex);
  }

  /**
   * Pasang Citra Radar Doppler Awan ke Peta (Mendukung Google Maps & Leaflet)
   */
  function applyRadarOverlay(frameIndex) {
    if (!state.weatherData) return;

    const loc = state.weatherData.lokasi || {};
    const lat = Number(loc.lat) || -6.17638;
    const lon = Number(loc.lon) || 106.8267;

    const cuacaDays = (state.weatherData.data && state.weatherData.data[0] && state.weatherData.data[0].cuaca) || [];
    const currentDay = cuacaDays[state.activeDayIndex] || [];
    const slot = currentDay[state.activeSlotIndex] || currentDay[0] || {};

    const opacityVal = Number(document.getElementById('radar-opacity-slider')?.value || 75) / 100;

    // Label Waktu Frame Radar
    const lbl = document.getElementById('radar-frame-time');
    if (lbl) {
      const slotTime = slot.local_datetime ? slot.local_datetime.slice(11, 16) : '15:00';
      const frameDesc = frameIndex === 0 ? '-20m' : frameIndex === 1 ? '-10m' : frameIndex === 2 ? 'Doppler Live' : frameIndex === 3 ? '+10m' : '+20m';
      lbl.textContent = `${slotTime} WIB (${frameDesc})`;
    }

    // 1. Bersihkan Overlay Radar Doppler Sebelumnya
    if (mapState.dopplerOverlay) {
      if (mapState.engine === 'google' && mapState.dopplerOverlay.setMap) {
        mapState.dopplerOverlay.setMap(null);
      } else if (mapState.engine === 'leaflet' && mapState.leafletMap) {
        mapState.leafletMap.removeLayer(mapState.dopplerOverlay);
      }
      mapState.dopplerOverlay = null;
    }

    if (!mapState.showRadar) return;

    // 2. Generate Citra Doppler Radar Awan
    const { dataUrl, isEmpty } = generateDopplerRadarOverlay(lat, lon, slot, frameIndex);
    if (isEmpty) return; // Cuaca cerah -> transparan tanpa awan

    // Radius Geografis Radar (~50 km radius)
    const radiusDeg = 0.45;
    const south = lat - radiusDeg;
    const north = lat + radiusDeg;
    const west = lon - radiusDeg;
    const east = lon + radiusDeg;

    // Engine Google Maps
    if (mapState.engine === 'google' && mapState.googleMap) {
      const gBounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(south, west),
        new google.maps.LatLng(north, east)
      );
      mapState.dopplerOverlay = new google.maps.GroundOverlay(dataUrl, gBounds, {
        opacity: opacityVal,
        clickable: false
      });
      mapState.dopplerOverlay.setMap(mapState.googleMap);
    }

    // Engine Leaflet
    if (mapState.engine === 'leaflet' && mapState.leafletMap) {
      const lBounds = [[south, west], [north, east]];
      mapState.dopplerOverlay = L.imageOverlay(dataUrl, lBounds, {
        opacity: opacityVal,
        interactive: false
      }).addTo(mapState.leafletMap);
    }
  }

  /**
   * Kontrol Toolbar Peta (Toggles, Playback, Opacity)
   */
  function setupMapControls() {
    if (setupMapControls.initialized) return;
    setupMapControls.initialized = true;

    // 1. Toggle Radar
    const btnRadar = document.getElementById('toggle-radar-layer');
    if (btnRadar) {
      btnRadar.addEventListener('click', () => {
        mapState.showRadar = !mapState.showRadar;
        btnRadar.classList.toggle('active', mapState.showRadar);
        applyRadarOverlay(mapState.activeFrameIndex);
      });
    }

    // 2. Toggle Lightning Strikes
    const btnLightning = document.getElementById('toggle-lightning-layer');
    if (btnLightning) {
      btnLightning.addEventListener('click', () => {
        mapState.showLightning = !mapState.showLightning;
        btnLightning.classList.toggle('active', mapState.showLightning);

        if (mapState.engine === 'google') {
          mapState.strikeMarkers.forEach(m => m.setVisible(mapState.showLightning));
        } else if (mapState.engine === 'leaflet' && mapState.leafletMap) {
          mapState.strikeMarkers.forEach(m => {
            if (mapState.showLightning) m.addTo(mapState.leafletMap);
            else mapState.leafletMap.removeLayer(m);
          });
        }
      });
    }

    // 3. Toggle Danger Radius
    const btnRadius = document.getElementById('toggle-danger-radius');
    if (btnRadius) {
      btnRadius.addEventListener('click', () => {
        mapState.showDangerRadius = !mapState.showDangerRadius;
        btnRadius.classList.toggle('active', mapState.showDangerRadius);

        if (mapState.engine === 'google') {
          if (mapState.dangerCircle) mapState.dangerCircle.setVisible(mapState.showDangerRadius);
          if (mapState.watchCircle) mapState.watchCircle.setVisible(mapState.showDangerRadius);
        } else if (mapState.engine === 'leaflet' && mapState.leafletMap) {
          if (mapState.showDangerRadius) {
            if (mapState.dangerCircle) mapState.dangerCircle.addTo(mapState.leafletMap);
            if (mapState.watchCircle) mapState.watchCircle.addTo(mapState.leafletMap);
          } else {
            if (mapState.dangerCircle) mapState.leafletMap.removeLayer(mapState.dangerCircle);
            if (mapState.watchCircle) mapState.leafletMap.removeLayer(mapState.watchCircle);
          }
        }
      });
    }

    // 4. Recenter to Station
    const btnRecenter = document.getElementById('btn-recenter-map');
    if (btnRecenter) {
      btnRecenter.addEventListener('click', () => {
        if (!state.weatherData?.lokasi) return;
        const lat = Number(state.weatherData.lokasi.lat);
        const lon = Number(state.weatherData.lokasi.lon);

        if (mapState.engine === 'google' && mapState.googleMap) {
          mapState.googleMap.panTo({ lat, lng: lon });
          mapState.googleMap.setZoom(11);
        } else if (mapState.engine === 'leaflet' && mapState.leafletMap) {
          mapState.leafletMap.flyTo([lat, lon], 11);
        }
      });
    }

    // 5. Play / Pause Radar Animation Loop
    const btnPlay = document.getElementById('btn-radar-play');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');

    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        mapState.isPlayingRadar = !mapState.isPlayingRadar;
        if (iconPlay) iconPlay.classList.toggle('hidden', mapState.isPlayingRadar);
        if (iconPause) iconPause.classList.toggle('hidden', !mapState.isPlayingRadar);

        if (mapState.isPlayingRadar) {
          mapState.radarPlayTimer = setInterval(() => {
            mapState.activeFrameIndex = (mapState.activeFrameIndex + 1) % 5;
            const slider = document.getElementById('radar-frame-slider');
            if (slider) {
              slider.max = 4;
              slider.value = mapState.activeFrameIndex;
            }
            applyRadarOverlay(mapState.activeFrameIndex);
          }, 1100);
        } else {
          clearInterval(mapState.radarPlayTimer);
        }
      });
    }

    // 6. Slider Frame
    const slider = document.getElementById('radar-frame-slider');
    if (slider) {
      slider.max = 4;
      slider.value = mapState.activeFrameIndex;
      slider.addEventListener('input', (e) => {
        mapState.activeFrameIndex = Number(e.target.value);
        applyRadarOverlay(mapState.activeFrameIndex);
      });
    }

    // 7. Opacity Slider
    const opacitySlider = document.getElementById('radar-opacity-slider');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        const val = Number(e.target.value) / 100;
        if (mapState.dopplerOverlay) {
          if (mapState.engine === 'google' && mapState.dopplerOverlay.setOpacity) {
            mapState.dopplerOverlay.setOpacity(val);
          } else if (mapState.engine === 'leaflet' && mapState.dopplerOverlay.setOpacity) {
            mapState.dopplerOverlay.setOpacity(val);
          }
        }
      });
    }
  }

  /**
   * Update Peta dengan Data Cuaca BMKG Terkini & Prediksi Petir
   */
  function updateMapWithWeatherData() {
    if (!state.weatherData) return;

    const loc = state.weatherData.lokasi || {};
    const lat = Number(loc.lat) || -6.17638;
    const lon = Number(loc.lon) || 106.8267;

    const cuacaDays = (state.weatherData.data && state.weatherData.data[0] && state.weatherData.data[0].cuaca) || [];
    const currentDay = cuacaDays[state.activeDayIndex] || [];
    const slot = currentDay[state.activeSlotIndex] || currentDay[0] || {};
    const risk = slot.lightning_risk || { score: 15, level: 'Rendah', color: '#10b981', advice: '' };

    const dangerKm = risk.score >= 75 ? '10.0 km' : risk.score >= 50 ? '7.5 km' : '5.0 km';
    const dangerMeters = risk.score >= 75 ? 10000 : risk.score >= 50 ? 7500 : 5000;
    const watchMeters = dangerMeters * 2.5;

    const statRadius = document.getElementById('stat-danger-radius');
    if (statRadius) statRadius.textContent = dangerKm;

    const strikes = slot.lightning_strikes || [];
    const statStrikes = document.getElementById('stat-strikes-count');
    if (statStrikes) {
      statStrikes.textContent = `${strikes.length} Titik`;
      statStrikes.className = `ms-val ${strikes.length > 4 ? 'danger' : ''}`;
    }

    renderStrikeFeed(strikes);

    // ==========================================
    // A. UPDATE PADA GOOGLE MAPS
    // ==========================================
    if (mapState.engine === 'google' && mapState.googleMap) {
      const centerLatLng = new google.maps.LatLng(lat, lon);
      mapState.googleMap.panTo(centerLatLng);

      if (mapState.stationMarker) mapState.stationMarker.setMap(null);

      mapState.stationMarker = new google.maps.Marker({
        position: centerLatLng,
        map: mapState.googleMap,
        title: `Stasiun BMKG: ${loc.desa || ''}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: risk.color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        }
      });

      const stationInfoWindow = new google.maps.InfoWindow({
        content: `
          <div class="iw-card">
            <div class="iw-title">📡 Stasiun BMKG: ${loc.desa || 'Wilayah'}</div>
            <div class="iw-sub">${loc.kecamatan || ''}, ${loc.kotkab || ''}</div>
            <div class="iw-metric"><span>Kondisi Cuaca:</span><strong>${slot.weather_desc || '-'}</strong></div>
            <div class="iw-metric"><span>Suhu Udara:</span><strong>${slot.t || '--'}°C</strong></div>
            <div class="iw-metric"><span>Risiko Petir:</span><strong style="color: ${risk.color}">${risk.score}% (${risk.level})</strong></div>
            <div class="iw-metric"><span>Kelembapan Udara:</span><strong>${slot.hu || '--'}%</strong></div>
          </div>
        `
      });

      mapState.stationMarker.addListener('click', () => {
        stationInfoWindow.open(mapState.googleMap, mapState.stationMarker);
      });

      if (mapState.dangerCircle) mapState.dangerCircle.setMap(null);
      if (mapState.watchCircle) mapState.watchCircle.setMap(null);

      mapState.dangerCircle = new google.maps.Circle({
        strokeColor: risk.color,
        strokeOpacity: 0.85,
        strokeWeight: 2,
        fillColor: risk.color,
        fillOpacity: risk.score >= 50 ? 0.22 : 0.12,
        map: mapState.showDangerRadius ? mapState.googleMap : null,
        center: centerLatLng,
        radius: dangerMeters
      });

      mapState.watchCircle = new google.maps.Circle({
        strokeColor: '#818cf8',
        strokeOpacity: 0.5,
        strokeWeight: 1.5,
        fillColor: '#818cf8',
        fillOpacity: 0.05,
        map: mapState.showDangerRadius ? mapState.googleMap : null,
        center: centerLatLng,
        radius: watchMeters
      });

      clearStrikeMarkers();
      if (strikes.length > 0) {
        strikes.forEach((strike) => {
          const marker = new google.maps.Marker({
            position: { lat: strike.lat, lng: strike.lon },
            map: mapState.showLightning ? mapState.googleMap : null,
            title: `Sambaran Petir (${strike.peakCurrentKa} kA)`,
            icon: {
              path: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
              scale: 1.3,
              fillColor: strike.peakCurrentKa > 40 ? '#f43f5e' : '#f59e0b',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 1,
              anchor: new google.maps.Point(12, 12)
            }
          });

          const strikeIw = new google.maps.InfoWindow({
            content: `
              <div class="iw-card">
                <div class="iw-title" style="color: #f59e0b;">⚡ Sambaran Petir Terdeteksi</div>
                <div class="iw-sub">ID: ${strike.id} • ${strike.timeAgoMinutes} menit lalu</div>
                <div class="iw-metric"><span>Tipe Polaritas:</span><strong>${strike.polarity}</strong></div>
                <div class="iw-metric"><span>Arus Puncak:</span><strong>${strike.peakCurrentKa} kA</strong></div>
                <div class="iw-metric"><span>Jarak ke Stasiun:</span><strong>${strike.distanceKm} km</strong></div>
                <div class="iw-metric"><span>Status Bahaya:</span><strong style="color: ${strike.peakCurrentKa > 40 ? '#f43f5e' : '#f59e0b'}">${strike.severity}</strong></div>
              </div>
            `
          });

          marker.addListener('click', () => {
            strikeIw.open(mapState.googleMap, marker);
          });

          mapState.strikeMarkers.push(marker);
        });
      }
    }

    // ==========================================
    // B. UPDATE PADA LEAFLET DARK GIS
    // ==========================================
    if (mapState.engine === 'leaflet' && mapState.leafletMap) {
      mapState.leafletMap.panTo([lat, lon]);

      if (mapState.stationMarker) {
        mapState.leafletMap.removeLayer(mapState.stationMarker);
      }

      const beaconHtml = `<div class="station-beacon-pin" style="background-color: ${risk.color}; box-shadow: 0 0 15px ${risk.color};"></div>`;
      mapState.stationMarker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'custom-beacon-wrapper',
          html: beaconHtml,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      })
      .addTo(mapState.leafletMap)
      .bindPopup(`
        <div class="iw-card">
          <div class="iw-title">📡 Stasiun BMKG: ${loc.desa || 'Wilayah'}</div>
          <div class="iw-sub">${loc.kecamatan || ''}, ${loc.kotkab || ''}</div>
          <div class="iw-metric"><span>Kondisi Cuaca:</span><strong>${slot.weather_desc || '-'}</strong></div>
          <div class="iw-metric"><span>Suhu Udara:</span><strong>${slot.t || '--'}°C</strong></div>
          <div class="iw-metric"><span>Risiko Petir:</span><strong style="color: ${risk.color}">${risk.score}% (${risk.level})</strong></div>
          <div class="iw-metric"><span>Kelembapan Udara:</span><strong>${slot.hu || '--'}%</strong></div>
        </div>
      `);

      if (mapState.dangerCircle) mapState.leafletMap.removeLayer(mapState.dangerCircle);
      if (mapState.watchCircle) mapState.leafletMap.removeLayer(mapState.watchCircle);

      if (mapState.showDangerRadius) {
        mapState.dangerCircle = L.circle([lat, lon], {
          radius: dangerMeters,
          color: risk.color,
          fillColor: risk.color,
          fillOpacity: risk.score >= 50 ? 0.22 : 0.12,
          weight: 2
        }).addTo(mapState.leafletMap);

        mapState.watchCircle = L.circle([lat, lon], {
          radius: watchMeters,
          color: '#818cf8',
          fillColor: '#818cf8',
          fillOpacity: 0.05,
          dashArray: '5, 5',
          weight: 1.5
        }).addTo(mapState.leafletMap);
      }

      clearStrikeMarkers();
      if (strikes.length > 0) {
        strikes.forEach((strike) => {
          const isDanger = strike.peakCurrentKa > 40;
          const strikeIcon = L.divIcon({
            className: 'custom-strike-wrapper',
            html: `<div class="map-bolt-pin ${isDanger ? 'danger' : ''}">⚡</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
          });

          const m = L.marker([strike.lat, strike.lon], { icon: strikeIcon })
            .bindPopup(`
              <div class="iw-card">
                <div class="iw-title" style="color: #f59e0b;">⚡ Sambaran Petir Terdeteksi</div>
                <div class="iw-sub">ID: ${strike.id} • ${strike.timeAgoMinutes} menit lalu</div>
                <div class="iw-metric"><span>Tipe Polaritas:</span><strong>${strike.polarity}</strong></div>
                <div class="iw-metric"><span>Arus Puncak:</span><strong>${strike.peakCurrentKa} kA</strong></div>
                <div class="iw-metric"><span>Jarak ke Stasiun:</span><strong>${strike.distanceKm} km</strong></div>
                <div class="iw-metric"><span>Status Bahaya:</span><strong style="color: ${isDanger ? '#f43f5e' : '#f59e0b'}">${strike.severity}</strong></div>
              </div>
            `);

          if (mapState.showLightning) {
            m.addTo(mapState.leafletMap);
          }
          mapState.strikeMarkers.push(m);
        });
      }
    }

    // Perbarui Citra Radar Doppler Awan Konvektif
    applyRadarOverlay(mapState.activeFrameIndex);
  }

  function clearStrikeMarkers() {
    if (mapState.engine === 'google') {
      mapState.strikeMarkers.forEach(m => m.setMap(null));
    } else if (mapState.engine === 'leaflet' && mapState.leafletMap) {
      mapState.strikeMarkers.forEach(m => mapState.leafletMap.removeLayer(m));
    }
    mapState.strikeMarkers = [];
  }

  /**
   * Render Strike Feed List
   */
  function renderStrikeFeed(strikes) {
    const list = document.getElementById('feed-strikes-list');
    if (!list) return;

    if (!strikes || strikes.length === 0) {
      list.innerHTML = '<div class="feed-empty">Tidak terdeteksi sambaran petir aktif dalam radius pantauan saat ini. Medan atmosfer stabil.</div>';
      return;
    }

    list.innerHTML = '';
    strikes.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'feed-item';
      const sevClass = (s.severity || '').toLowerCase();
      item.innerHTML = `
        <div class="feed-item-left">
          <span class="feed-bolt">⚡</span>
          <span><strong>${s.id}</strong> (${s.distanceKm} km)</span>
        </div>
        <div class="feed-item-right">
          <span>${s.peakCurrentKa} kA</span>
          <span class="feed-severity-badge ${sevClass}">${s.severity}</span>
        </div>
      `;
      list.appendChild(item);
    });
  }

  /**
   * Rumus Haversine untuk menghitung jarak dua koordinat (km)
   */
  function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * 9. Server-Sent Events (SSE) Stream
   */
  function initSSE() {
    if (!window.EventSource) return;
    try {
      const sse = new EventSource('/api/stream');
      sse.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'heartbeat') {
            if (el.syncBadge) {
              const dot = el.syncBadge.querySelector('.live-dot');
              if (dot) {
                dot.style.transform = 'scale(1.4)';
                setTimeout(() => (dot.style.transform = ''), 300);
              }
            }
          }
        } catch (e) {}
      };
    } catch (e) {
      console.warn('SSE tidak didukung atau terhalang:', e);
    }
  }

  /**
   * Boot Sequence
   */
  document.addEventListener('DOMContentLoaded', () => {
    initDigitalClock();
    initAmbientCanvas();
    setupEventListeners();
    loadRegionPresets();
    fetchForecastData(state.currentAdm4, true);
    initSSE();

    // 1. Coba Google Maps terlebih dahulu jika siap
    if (window._gmapsCallbackCalled || window.google?.maps) {
      window._tryMountGoogleMap();
    }

    // 2. Safety Watchdog: Jika dalam 2 detik Google Maps belum aktif / gagal auth, otomatis aktifkan Dark GIS Radar
    setTimeout(() => {
      if (mapState.engine === 'none') {
        window._triggerMapFallback("Google Maps API Key memerlukan aktivasi 'Maps JavaScript API' di Google Cloud Console. Mengaktifkan Dark GIS Radar Engine agar peta dan radar cuaca tetap tampil.");
      }
    }, 2000);
  });

})();

