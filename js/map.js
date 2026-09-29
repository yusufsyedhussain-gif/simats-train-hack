/**
 * map.js — Leaflet Map, Autocomplete, Road Routing & Ride States
 *
 * Features:
 *  - Leaflet map centered on Mumbai with OSM tiles
 *  - Nominatim autocomplete for From/To location inputs
 *  - OSRM road-following route drawing (not straight lines)
 *  - Ride state machine: SEARCHING → REQUESTED → ACCEPTED → IN_PROGRESS → COMPLETED
 *  - Dynamic right-panel UI for each ride state
 *
 * FUTURE:
 *  - Heatmap layer (Leaflet.heat plugin)
 *  - Marker clustering (Leaflet.markercluster)
 *  - Live position updates via WebSocket
 *  - Real-time ETA recalculation
 */

(function () {
  'use strict';

  // ── Map Init ──────────────────────────────────────────────────
  const map = L.map('map', {
    center: [19.1100, 72.8650],
    zoom: 13,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);


  // ── Custom Icons ──────────────────────────────────────────────
  function makeIcon(emoji, color) {
    return L.divIcon({
      html: `<div style="
        background:${color};
        color:#fff;
        width:32px;height:32px;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
        border:2px solid #fff;
        box-shadow:0 2px 6px rgba(0,0,0,.25);
        font-size:14px;
      "><span style="transform:rotate(45deg)">${emoji}</span></div>`,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -36],
    });
  }

  function makePulsingIcon(emoji, color) {
    return L.divIcon({
      html: `<div style="position:relative;">
        <div style="
          position:absolute;
          width:40px;height:40px;
          border-radius:50%;
          background:${color};
          opacity:0.3;
          top:-4px;left:-4px;
          animation: pulse-ring 1.5s ease-out infinite;
        "></div>
        <div style="
          background:${color};
          color:#fff;
          width:32px;height:32px;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          display:flex;align-items:center;justify-content:center;
          border:2px solid #fff;
          box-shadow:0 2px 6px rgba(0,0,0,.25);
          font-size:14px;
          position:relative;
          z-index:2;
        "><span style="transform:rotate(45deg)">${emoji}</span></div>
      </div>`,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -36],
    });
  }

  const iconDriver  = makeIcon('🚗', '#2563eb');
  const iconPickup  = makeIcon('📍', '#16a34a');
  const iconDropoff = makeIcon('🏁', '#d97706');
  const iconLive    = makePulsingIcon('🚗', '#16a34a');


  // ── State ─────────────────────────────────────────────────────
  let originCoords = null;   // [lat, lng]
  let destCoords   = null;   // [lat, lng]
  let routeLayers  = [];     // all polylines/markers on map (for clearing)
  let rideState    = 'SEARCHING';  // SEARCHING | REQUESTED | ACCEPTED | IN_PROGRESS | COMPLETED
  let activeMatchId = null;
  let liveMarker   = null;
  let liveInterval = null;

  // Demo match data
  const DEMO_MATCHES = [
    {
      id: 1,
      name: 'Priya Menon',
      avatar: '👩',
      rating: 4.9,
      trust: 91,
      price: 110,
      matchPct: 94,
      overlap: '8.2 km',
      time: '9:00 AM',
      from: 'Versova',
      to: 'BKC Gate 3',
      seats: 2,
      vehicle: 'White Hyundai Creta',
      plate: 'MH 02 CD 7890',
      phone: '+91 98XXX XXXX2',
      fromCoords: [19.1313, 72.8258],
      toCoords: [19.0650, 72.8650],
    },
    {
      id: 2,
      name: 'Dev Kapoor',
      avatar: '👨',
      rating: 4.7,
      trust: 88,
      price: 95,
      matchPct: 78,
      overlap: '6.1 km',
      time: '9:15 AM',
      from: 'Andheri Stn',
      to: 'MMRDA, BKC',
      seats: 3,
      vehicle: 'Black Honda City',
      plate: 'MH 04 EF 1234',
      phone: '+91 97XXX XXXX1',
      fromCoords: [19.1280, 72.8350],
      toCoords: [19.0680, 72.8700],
    },
    {
      id: 3,
      name: 'Nidhi Shah',
      avatar: '👩',
      rating: 4.5,
      trust: 82,
      price: 130,
      matchPct: 65,
      overlap: '5.0 km',
      time: '9:30 AM',
      from: 'DN Nagar',
      to: 'BKC Kurla',
      seats: 1,
      vehicle: 'Silver Maruti Baleno',
      plate: 'MH 01 GH 5678',
      phone: '+91 99XXX XXXX3',
      fromCoords: [19.1380, 72.8300],
      toCoords: [19.0720, 72.8620],
    },
  ];


  // ══════════════════════════════════════════════════════════════
  // AUTOCOMPLETE — Nominatim geocoding
  // ══════════════════════════════════════════════════════════════

  let autocompleteDebounce = null;

  function setupAutocomplete(inputId, onSelect) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    dropdown.style.display = 'none';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);

    input.addEventListener('input', () => {
      clearTimeout(autocompleteDebounce);
      const query = input.value.trim();
      if (query.length < 3) {
        dropdown.style.display = 'none';
        return;
      }

      autocompleteDebounce = setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=in&addressdetails=1`;
          const resp = await fetch(url, {
            headers: { 'Accept-Language': 'en' }
          });
          const results = await resp.json();

          if (results.length === 0) {
            dropdown.innerHTML = '<div class="autocomplete-item no-results">No results found</div>';
            dropdown.style.display = 'block';
            return;
          }

          dropdown.innerHTML = '';
          results.forEach(r => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';

            // Parse display name into primary + secondary
            const parts = r.display_name.split(',');
            const primary = parts.slice(0, 2).join(',').trim();
            const secondary = parts.slice(2, 4).join(',').trim();

            item.innerHTML = `
              <div class="autocomplete-primary">📍 ${primary}</div>
              <div class="autocomplete-secondary">${secondary}</div>
            `;

            item.addEventListener('click', () => {
              input.value = primary;
              dropdown.style.display = 'none';
              const coords = [parseFloat(r.lat), parseFloat(r.lon)];
              onSelect(coords, primary);
            });

            dropdown.appendChild(item);
          });
          dropdown.style.display = 'block';

        } catch (err) {
          console.warn('[Autocomplete] Nominatim error:', err);
          dropdown.innerHTML = '<div class="autocomplete-item no-results">Search unavailable</div>';
          dropdown.style.display = 'block';
        }
      }, 350);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    // Close on Escape
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dropdown.style.display = 'none';
    });
  }

  // Initialize autocomplete on both inputs
  setupAutocomplete('map-origin', (coords, name) => {
    originCoords = coords;
    console.log('[Map] Origin set:', name, coords);
  });

  setupAutocomplete('map-dest', (coords, name) => {
    destCoords = coords;
    console.log('[Map] Destination set:', name, coords);
  });


  // ══════════════════════════════════════════════════════════════
  // OSRM ROUTING — Road-following polylines
  // ══════════════════════════════════════════════════════════════

  /**
   * Fetch a road-following route from OSRM between two [lat,lng] points.
   * Returns an array of [lat, lng] pairs representing the route.
   */
  async function getRoute(from, to) {
    try {
      // OSRM expects coordinates as lng,lat (not lat,lng)
      const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
        console.warn('[OSRM] No route found');
        return null;
      }

      const route = data.routes[0];
      // GeoJSON uses [lng, lat], we need [lat, lng] for Leaflet
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

      return {
        coords,
        distance: route.distance,  // meters
        duration: route.duration,   // seconds
      };

    } catch (err) {
      console.error('[OSRM] Routing error:', err);
      return null;
    }
  }


  /**
   * Clear all route layers from the map
   */
  function clearRoutes() {
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];
  }


  /**
   * Draw a route on the map with specified style
   */
  function drawRoute(coords, options = {}) {
    const defaults = {
      color: '#2563eb',
      weight: 5,
      opacity: 0.8,
      dashArray: null,
    };
    const opts = { ...defaults, ...options };

    const polyline = L.polyline(coords, {
      color: opts.color,
      weight: opts.weight,
      opacity: opts.opacity,
      dashArray: opts.dashArray,
    }).addTo(map);

    routeLayers.push(polyline);
    return polyline;
  }


  /**
   * Add a marker to the map and track it for clearing
   */
  function addMarker(latlng, icon, popupText) {
    const marker = L.marker(latlng, { icon }).addTo(map);
    if (popupText) marker.bindPopup(popupText);
    routeLayers.push(marker);
    return marker;
  }


  // ══════════════════════════════════════════════════════════════
  // SEARCH — Draw rider route + driver routes
  // ══════════════════════════════════════════════════════════════

  async function searchAndDrawRoutes() {
    const searchBtn = document.getElementById('search-route-btn');
    if (searchBtn) {
      searchBtn.disabled = true;
      searchBtn.textContent = '⏳ Searching...';
    }

    clearRoutes();
    setRideState('SEARCHING');

    // If no coordinates selected, use defaults (Andheri West → BKC)
    const origin = originCoords || [19.1200, 72.8320];
    const dest   = destCoords   || [19.0650, 72.8650];

    // Draw rider route
    const riderRoute = await getRoute(origin, dest);
    if (riderRoute) {
      drawRoute(riderRoute.coords, { color: '#16a34a', weight: 5, opacity: 0.8 })
        .bindPopup(`<strong>Your route</strong><br>${(riderRoute.distance / 1000).toFixed(1)} km · ~${Math.round(riderRoute.duration / 60)} min`);
    }

    // Place rider markers
    addMarker(origin, iconPickup, '<strong>Your Pickup</strong>');
    addMarker(dest, iconDropoff, '<strong>Your Drop-off</strong>');

    // Draw demo driver routes
    for (const match of DEMO_MATCHES) {
      const driverRoute = await getRoute(match.fromCoords, match.toCoords);
      if (driverRoute) {
        const line = drawRoute(driverRoute.coords, {
          color: '#2563eb',
          weight: 4,
          opacity: 0.5,
          dashArray: '8,6',
        });
        line.bindPopup(`<strong>${match.name}'s route</strong><br>${match.from} → ${match.to}`);
        // Store route data on match for later use
        match._routeCoords = driverRoute.coords;
        match._routeDistance = driverRoute.distance;
        match._routeDuration = driverRoute.duration;
      }

      addMarker(match.fromCoords, iconDriver,
        `<strong>${match.name} (Driver)</strong><br>Departs ${match.time}<br>⭐ ${match.rating} · Trust ${match.trust}`);
    }

    // Fit map to show all
    const allPoints = [origin, dest, ...DEMO_MATCHES.map(m => m.fromCoords), ...DEMO_MATCHES.map(m => m.toCoords)];
    map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });

    // Render match cards
    renderMatchList();

    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = '🔍 Search Matches';
    }
  }


  // ══════════════════════════════════════════════════════════════
  // MATCH CARD RENDERING
  // ══════════════════════════════════════════════════════════════

  function renderMatchList() {
    const container = document.getElementById('match-results-list');
    if (!container) return;

    container.innerHTML = '';

    DEMO_MATCHES.forEach(match => {
      const badgeClass = match.matchPct >= 90 ? 'badge-success' : match.matchPct >= 70 ? 'badge-warning' : 'badge-neutral';
      const fillClass  = match.matchPct >= 90 ? 'high' : match.matchPct >= 70 ? 'medium' : 'low';

      const card = document.createElement('div');
      card.className = 'match-card mb-3';
      card.id = `map-match-${match.id}`;
      card.onclick = () => highlightMatch(match.id);

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="match-avatar">${match.avatar}</div>
          <div style="flex:1;">
            <div class="match-name">${match.name}</div>
            <div class="match-meta">⭐ ${match.rating} · Trust ${match.trust}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div class="match-price">₹${match.price}</div>
            <div class="match-meta">/seat</div>
          </div>
        </div>
        <div class="flex gap-2 mt-2" style="align-items:center;">
          <span class="badge ${badgeClass}">${match.matchPct}% match</span>
          <span class="badge badge-neutral">${match.overlap} overlap</span>
          <span class="badge badge-neutral">${match.time}</span>
        </div>
        <div class="match-score-bar mt-2">
          <div class="fill ${fillClass}" style="width:${match.matchPct}%"></div>
        </div>
        <div style="font-size:12px;color:var(--color-muted);margin-top:6px;">
          📍 ${match.from} → 🏁 ${match.to} · ${match.seats} seat${match.seats > 1 ? 's' : ''} left
        </div>
        <div class="match-actions">
          <button class="btn btn-success btn-sm" id="map-req-${match.id}" onclick="event.stopPropagation(); window.RidePoolMap.requestRide(${match.id})">✓ Request</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); window.RidePoolMap.showRouteDetail(${match.id})">Route ›</button>
        </div>
      `;

      container.appendChild(card);
    });

    document.getElementById('match-count-badge').textContent = `${DEMO_MATCHES.length} found`;
  }


  // ══════════════════════════════════════════════════════════════
  // RIDE STATE MACHINE
  // ══════════════════════════════════════════════════════════════

  function setRideState(state) {
    rideState = state;
    // Update right panel heading
    const panelTitle = document.querySelector('#map-right-panel .map-sidebar-title');
    if (panelTitle) {
      const titles = {
        'SEARCHING':   'Match Results',
        'REQUESTED':   'Ride Requested',
        'ACCEPTED':    'Ride Accepted',
        'IN_PROGRESS': 'Ride In Progress',
        'COMPLETED':   'Ride Completed',
      };
      panelTitle.textContent = titles[state] || 'Match Results';
    }
  }


  /**
   * Request a ride — transitions from SEARCHING to REQUESTED
   */
  window.RidePoolMap = window.RidePoolMap || {};
  window.RidePoolMap.requestRide = function (matchId) {
    const match = DEMO_MATCHES.find(m => m.id === matchId);
    if (!match) return;

    activeMatchId = matchId;
    setRideState('REQUESTED');

    const container = document.getElementById('match-results-list');
    const badge = document.getElementById('match-count-badge');

    badge.textContent = 'Requested';
    badge.className = 'badge badge-warning';

    container.innerHTML = `
      <div class="ride-state-card">
        <div class="ride-state-header">
          <div class="ride-state-icon pending">⏳</div>
          <div>
            <div class="ride-state-title">Request Sent</div>
            <div class="ride-state-subtitle">Waiting for ${match.name} to accept...</div>
          </div>
        </div>

        <div class="ride-state-driver">
          <div class="match-avatar" style="width:56px;height:56px;font-size:24px;">${match.avatar}</div>
          <div>
            <div style="font-weight:600;font-size:15px;">${match.name}</div>
            <div style="font-size:13px;color:var(--color-muted);">⭐ ${match.rating} · Trust ${match.trust}</div>
            <div style="font-size:13px;color:var(--color-muted);margin-top:2px;">${match.vehicle}</div>
          </div>
        </div>

        <div class="ride-state-route">
          <div class="route-line">
            <div class="route-point"><div class="route-dot"></div><span>${match.from}</span></div>
            <div class="route-connector"></div>
            <div class="route-point"><div class="route-dot end"></div><span>${match.to}</span></div>
          </div>
          <div class="ride-state-details">
            <div class="detail-item">
              <span class="detail-label">Departure</span>
              <span class="detail-value">${match.time}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Price</span>
              <span class="detail-value">₹${match.price}/seat</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Seats</span>
              <span class="detail-value">${match.seats} available</span>
            </div>
          </div>
        </div>

        <div class="ride-state-timer" id="request-timer">
          <div class="timer-bar"><div class="timer-fill" id="timer-fill"></div></div>
          <div style="font-size:12px;color:var(--color-muted);margin-top:4px;">Driver typically responds within 2 min</div>
        </div>

        <div class="ride-state-actions">
          <button class="btn btn-danger btn-sm w-full" onclick="window.RidePoolMap.cancelRequest()">✕ Cancel Request</button>
        </div>
      </div>
    `;

    // Animate timer, then auto-accept after 4 seconds (demo)
    const fill = document.getElementById('timer-fill');
    if (fill) {
      fill.style.transition = 'width 4s linear';
      requestAnimationFrame(() => { fill.style.width = '100%'; });
    }

    setTimeout(() => {
      if (rideState === 'REQUESTED') {
        acceptRide(matchId);
      }
    }, 4000);
  };


  /**
   * Cancel ride request
   */
  window.RidePoolMap.cancelRequest = function () {
    activeMatchId = null;
    setRideState('SEARCHING');

    const badge = document.getElementById('match-count-badge');
    badge.textContent = `${DEMO_MATCHES.length} found`;
    badge.className = 'badge badge-primary';

    renderMatchList();
    if (window.RidePoolApp) window.RidePoolApp.showToast('Request cancelled', 'info');
  };


  /**
   * Ride accepted by driver — show ACCEPTED state with driver info + map
   */
  function acceptRide(matchId) {
    const match = DEMO_MATCHES.find(m => m.id === matchId);
    if (!match) return;

    setRideState('ACCEPTED');

    const badge = document.getElementById('match-count-badge');
    badge.textContent = 'Accepted ✓';
    badge.className = 'badge badge-success';

    const container = document.getElementById('match-results-list');
    container.innerHTML = `
      <div class="ride-state-card">
        <div class="ride-state-header">
          <div class="ride-state-icon accepted">✓</div>
          <div>
            <div class="ride-state-title">Ride Confirmed!</div>
            <div class="ride-state-subtitle">${match.name} accepted your request</div>
          </div>
        </div>

        <div class="ride-state-driver">
          <div class="match-avatar" style="width:56px;height:56px;font-size:24px;">${match.avatar}</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:15px;">${match.name}</div>
            <div style="font-size:13px;color:var(--color-muted);">⭐ ${match.rating} · Trust ${match.trust}</div>
          </div>
          <span class="badge badge-success">Verified</span>
        </div>

        <div class="ride-state-info-grid">
          <div class="info-block">
            <div class="info-icon">🚗</div>
            <div class="info-label">Vehicle</div>
            <div class="info-value">${match.vehicle}</div>
          </div>
          <div class="info-block">
            <div class="info-icon">🔢</div>
            <div class="info-label">Plate</div>
            <div class="info-value">${match.plate}</div>
          </div>
          <div class="info-block">
            <div class="info-icon">⏰</div>
            <div class="info-label">Pickup</div>
            <div class="info-value">${match.time}</div>
          </div>
          <div class="info-block">
            <div class="info-icon">💰</div>
            <div class="info-label">Fare</div>
            <div class="info-value">₹${match.price}</div>
          </div>
        </div>

        <div class="ride-state-route">
          <div class="route-line">
            <div class="route-point"><div class="route-dot"></div><span>${match.from}</span></div>
            <div class="route-connector"></div>
            <div class="route-point"><div class="route-dot end"></div><span>${match.to}</span></div>
          </div>
        </div>

        <div class="ride-state-contact">
          <button class="btn btn-secondary btn-sm" onclick="if(window.RidePoolApp) window.RidePoolApp.showToast('Chat coming soon!', 'info')">💬 Message</button>
          <button class="btn btn-secondary btn-sm" onclick="if(window.RidePoolApp) window.RidePoolApp.showToast('Calling ${match.name}...', 'info')">📞 Call</button>
          <button class="btn btn-ghost btn-sm" onclick="if(window.RidePoolApp) window.RidePoolApp.showToast('Share link copied!', 'success')">📤 Share</button>
        </div>

        <div class="ride-state-actions">
          <button class="btn btn-primary w-full" id="start-ride-btn" onclick="window.RidePoolMap.startRide(${match.id})">🚀 Driver is Approaching — Start Ride</button>
        </div>

        <div class="ride-state-actions" style="margin-top:8px;">
          <button class="btn btn-ghost btn-sm w-full" onclick="window.RidePoolMap.cancelRide()">Cancel Ride</button>
        </div>
      </div>
    `;

    // Clear old routes and draw only the matched route
    clearRoutes();
    const origin = originCoords || [19.1200, 72.8320];
    const dest   = destCoords   || [19.0650, 72.8650];

    // Draw accepted driver route prominently
    (async () => {
      const driverRoute = await getRoute(match.fromCoords, match.toCoords);
      if (driverRoute) {
        drawRoute(driverRoute.coords, { color: '#2563eb', weight: 6, opacity: 0.9 });
      }
      addMarker(origin, iconPickup, '<strong>Your Pickup</strong>');
      addMarker(dest, iconDropoff, '<strong>Your Drop-off</strong>');
      addMarker(match.fromCoords, iconDriver,
        `<strong>${match.name}</strong><br>${match.vehicle}<br>${match.plate}`);

      map.fitBounds(L.latLngBounds([origin, dest, match.fromCoords, match.toCoords]), { padding: [60, 60] });
    })();

    if (window.RidePoolApp) window.RidePoolApp.showToast(`${match.name} accepted your ride!`, 'success');
  }


  /**
   * Start ride — transitions to IN_PROGRESS with live tracking simulation
   */
  window.RidePoolMap.startRide = function (matchId) {
    const match = DEMO_MATCHES.find(m => m.id === matchId);
    if (!match) return;

    setRideState('IN_PROGRESS');

    const badge = document.getElementById('match-count-badge');
    badge.textContent = 'En Route 🚗';
    badge.className = 'badge badge-primary';

    const container = document.getElementById('match-results-list');
    container.innerHTML = `
      <div class="ride-state-card">
        <div class="ride-state-header live">
          <div class="ride-state-icon live-icon">🚗</div>
          <div>
            <div class="ride-state-title">Ride In Progress</div>
            <div class="ride-state-subtitle">You are on your way!</div>
          </div>
        </div>

        <div class="ride-state-driver compact">
          <div class="match-avatar" style="width:44px;height:44px;font-size:20px;">${match.avatar}</div>
          <div style="flex:1;">
            <div style="font-weight:600;">${match.name}</div>
            <div style="font-size:12px;color:var(--color-muted);">${match.vehicle} · ${match.plate}</div>
          </div>
        </div>

        <div class="ride-live-stats">
          <div class="live-stat">
            <div class="live-stat-value" id="live-eta">12 min</div>
            <div class="live-stat-label">ETA</div>
          </div>
          <div class="live-stat">
            <div class="live-stat-value" id="live-distance">8.2 km</div>
            <div class="live-stat-label">Remaining</div>
          </div>
          <div class="live-stat">
            <div class="live-stat-value" id="live-speed">32 km/h</div>
            <div class="live-stat-label">Speed</div>
          </div>
        </div>

        <div class="ride-state-progress">
          <div class="progress-track">
            <div class="progress-fill" id="ride-progress-fill" style="width:5%;"></div>
          </div>
          <div class="flex justify-between" style="font-size:11px;color:var(--color-muted);margin-top:4px;">
            <span>📍 ${match.from}</span>
            <span>🏁 ${match.to}</span>
          </div>
        </div>

        <div class="ride-state-route" style="margin-top:12px;">
          <div style="font-size:12px;font-weight:600;color:var(--color-text-secondary);margin-bottom:8px;">Live Updates</div>
          <div class="ride-updates" id="ride-updates">
            <div class="ride-update">
              <span class="update-time">Now</span>
              <span class="update-text">Ride started · Picked up at ${match.from}</span>
            </div>
          </div>
        </div>

        <div class="ride-state-contact" style="margin-top:12px;">
          <button class="btn btn-secondary btn-sm" onclick="if(window.RidePoolApp) window.RidePoolApp.showToast('Chat coming soon!', 'info')">💬 Message</button>
          <button class="btn btn-danger btn-sm" onclick="if(window.RidePoolApp) window.RidePoolApp.showToast('SOS alert sent!', 'danger')">🚨 SOS</button>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="if(window.RidePoolApp) window.RidePoolApp.showToast('Share link copied!', 'success')">📤 Share ETA</button>
        </div>

        <div class="ride-state-actions" style="margin-top:12px;">
          <button class="btn btn-primary w-full" id="complete-ride-btn" onclick="window.RidePoolMap.completeRide(${match.id})">🏁 Complete Ride (Demo)</button>
        </div>
      </div>
    `;

    // Simulate live tracking on the driver's route
    simulateLiveTracking(match);

    if (window.RidePoolApp) window.RidePoolApp.showToast('Ride started! Have a safe journey.', 'success');
  };


  /**
   * Simulate a car moving along the driver route
   */
  function simulateLiveTracking(match) {
    if (liveInterval) clearInterval(liveInterval);
    if (liveMarker) {
      map.removeLayer(liveMarker);
      liveMarker = null;
    }

    const routeCoords = match._routeCoords;
    if (!routeCoords || routeCoords.length < 2) return;

    let step = 0;
    const totalSteps = routeCoords.length;
    const stepSize = Math.max(1, Math.floor(totalSteps / 40));  // ~40 animation frames

    liveMarker = L.marker(routeCoords[0], { icon: iconLive, zIndexOffset: 1000 }).addTo(map);
    liveMarker.bindPopup(`<strong>${match.name}</strong><br>In transit`);
    routeLayers.push(liveMarker);

    const updates = [
      'Moving through traffic...',
      'On Western Express Highway',
      'Crossing Jogeshwari overpass',
      'Approaching BKC junction',
      'Almost there!',
    ];
    let updateIdx = 0;

    liveInterval = setInterval(() => {
      step += stepSize;
      if (step >= totalSteps) {
        step = totalSteps - 1;
        clearInterval(liveInterval);
      }

      liveMarker.setLatLng(routeCoords[step]);
      map.panTo(routeCoords[step], { animate: true, duration: 0.5 });

      // Update stats
      const progress = Math.min(100, Math.round((step / totalSteps) * 100));
      const remainKm = Math.max(0, (match._routeDistance / 1000) * (1 - step / totalSteps)).toFixed(1);
      const etaMin = Math.max(1, Math.round((match._routeDuration / 60) * (1 - step / totalSteps)));

      const progressFill = document.getElementById('ride-progress-fill');
      if (progressFill) progressFill.style.width = `${progress}%`;

      const etaEl = document.getElementById('live-eta');
      if (etaEl) etaEl.textContent = `${etaMin} min`;

      const distEl = document.getElementById('live-distance');
      if (distEl) distEl.textContent = `${remainKm} km`;

      const speedEl = document.getElementById('live-speed');
      if (speedEl) speedEl.textContent = `${Math.round(25 + Math.random() * 15)} km/h`;

      // Add timeline update
      if (progress > (updateIdx + 1) * 20 && updateIdx < updates.length) {
        const updatesEl = document.getElementById('ride-updates');
        if (updatesEl) {
          const div = document.createElement('div');
          div.className = 'ride-update';
          div.innerHTML = `<span class="update-time">${etaMin} min ago</span><span class="update-text">${updates[updateIdx]}</span>`;
          updatesEl.prepend(div);
        }
        updateIdx++;
      }
    }, 800);
  }


  /**
   * Complete ride — show summary / rating
   */
  window.RidePoolMap.completeRide = function (matchId) {
    const match = DEMO_MATCHES.find(m => m.id === matchId);
    if (!match) return;

    if (liveInterval) clearInterval(liveInterval);
    setRideState('COMPLETED');

    const badge = document.getElementById('match-count-badge');
    badge.textContent = 'Completed ✓';
    badge.className = 'badge badge-success';

    const container = document.getElementById('match-results-list');
    container.innerHTML = `
      <div class="ride-state-card">
        <div class="ride-state-header completed">
          <div class="ride-state-icon completed-icon">🎉</div>
          <div>
            <div class="ride-state-title">Ride Complete!</div>
            <div class="ride-state-subtitle">You've arrived at ${match.to}</div>
          </div>
        </div>

        <div class="ride-state-driver">
          <div class="match-avatar" style="width:56px;height:56px;font-size:24px;">${match.avatar}</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:15px;">${match.name}</div>
            <div style="font-size:13px;color:var(--color-muted);">⭐ ${match.rating} · Trust ${match.trust}</div>
          </div>
        </div>

        <div class="ride-summary">
          <div class="summary-row">
            <span>Route</span>
            <span>${match.from} → ${match.to}</span>
          </div>
          <div class="summary-row">
            <span>Distance</span>
            <span>${match._routeDistance ? (match._routeDistance / 1000).toFixed(1) + ' km' : match.overlap}</span>
          </div>
          <div class="summary-row">
            <span>Duration</span>
            <span>${match._routeDuration ? Math.round(match._routeDuration / 60) + ' min' : '~15 min'}</span>
          </div>
          <div class="summary-row total">
            <span>Fare</span>
            <span style="color:var(--color-success);font-weight:700;">₹${match.price}</span>
          </div>
          <div class="summary-row savings">
            <span>You saved vs solo</span>
            <span style="color:var(--color-success);">₹${Math.round(match.price * 0.4)}</span>
          </div>
        </div>

        <div class="ride-rating" id="ride-rating">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--color-text-secondary);">Rate your ride</div>
          <div class="star-rating" id="star-rating">
            <span class="star" data-v="1">★</span>
            <span class="star" data-v="2">★</span>
            <span class="star" data-v="3">★</span>
            <span class="star" data-v="4">★</span>
            <span class="star" data-v="5">★</span>
          </div>
          <textarea class="form-input" placeholder="Leave a comment (optional)" style="margin-top:8px;min-height:60px;resize:vertical;" id="ride-comment"></textarea>
        </div>

        <div class="ride-state-actions">
          <button class="btn btn-primary w-full" onclick="window.RidePoolMap.submitRating(${match.id})">Submit Rating</button>
        </div>

        <div class="ride-state-actions" style="margin-top:8px;">
          <button class="btn btn-ghost btn-sm w-full" onclick="window.RidePoolMap.backToSearch()">← Find Another Ride</button>
        </div>
      </div>
    `;

    // Wire star rating
    const stars = document.querySelectorAll('#star-rating .star');
    stars.forEach(star => {
      star.addEventListener('click', () => {
        const val = parseInt(star.dataset.v);
        stars.forEach(s => {
          s.classList.toggle('active', parseInt(s.dataset.v) <= val);
        });
      });
      star.addEventListener('mouseenter', () => {
        const val = parseInt(star.dataset.v);
        stars.forEach(s => {
          s.classList.toggle('hover', parseInt(s.dataset.v) <= val);
        });
      });
      star.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('hover'));
      });
    });

    if (window.RidePoolApp) window.RidePoolApp.showToast('You\'ve arrived! Rate your ride.', 'success');
  };


  window.RidePoolMap.submitRating = function (matchId) {
    const match = DEMO_MATCHES.find(m => m.id === matchId);
    const activeStars = document.querySelectorAll('#star-rating .star.active');
    const rating = activeStars.length || 5;
    if (window.RidePoolApp) window.RidePoolApp.showToast(`Rated ${match?.name} ${rating} stars! Thanks.`, 'success');
    setTimeout(() => window.RidePoolMap.backToSearch(), 1500);
  };


  /**
   * Cancel ride from ACCEPTED state
   */
  window.RidePoolMap.cancelRide = function () {
    if (liveInterval) clearInterval(liveInterval);
    activeMatchId = null;
    if (window.RidePoolApp) window.RidePoolApp.showToast('Ride cancelled', 'warning');
    window.RidePoolMap.backToSearch();
  };


  /**
   * Go back to search results
   */
  window.RidePoolMap.backToSearch = function () {
    if (liveInterval) clearInterval(liveInterval);
    activeMatchId = null;
    setRideState('SEARCHING');

    const badge = document.getElementById('match-count-badge');
    badge.textContent = `${DEMO_MATCHES.length} found`;
    badge.className = 'badge badge-primary';

    searchAndDrawRoutes();
  };


  // ── Highlight Match Route ─────────────────────────────────────
  function highlightMatch(matchId) {
    document.querySelectorAll('.match-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('map-match-' + matchId)?.classList.add('selected');

    const match = DEMO_MATCHES.find(m => m.id === matchId);
    if (match) {
      map.flyTo(match.fromCoords, 14, { duration: 0.8 });
    }
  }
  window.highlightRoute = highlightMatch;


  window.RidePoolMap.showRouteDetail = function (matchId) {
    const match = DEMO_MATCHES.find(m => m.id === matchId);
    if (match) {
      map.flyTo(match.fromCoords, 15, { duration: 0.8 });
      if (window.RidePoolApp) window.RidePoolApp.showToast(`Showing ${match.name}'s route`, 'info');
    }
  };


  // ── Map Click — Set Pickup / Drop-off ─────────────────────────
  map.on('click', function (e) {
    // FUTURE: setPickupOrDropoff(e.latlng)
  });


  // ── Search Button Wiring ──────────────────────────────────────
  document.getElementById('search-route-btn')?.addEventListener('click', () => {
    searchAndDrawRoutes();
  });


  // ── Initial Load ──────────────────────────────────────────────
  // Run initial search with default values
  searchAndDrawRoutes();


  // ── Expose map + module globally ──────────────────────────────
  window.RidePoolMap = Object.assign(window.RidePoolMap || {}, {
    map,
    searchAndDrawRoutes,
    highlightMatch,
    getRoute,
  });

}());
