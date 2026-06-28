// scripts/map.js
// Leaflet map engine — calls Nominatim and OSRM directly from the browser.
// No backend required for map features; this makes the map work even before
// the Express server is running.
//
// Depends on: Leaflet.js (loaded via CDN in HTML before this script)

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let map           = null;
let pickupMarker  = null;
let destMarker    = null;
let routeLayer    = null;
let clickMode     = 'pickup';

window.mapState = {
  pickup:      null,
  destination: null,
  distanceKm:  null,
  durationMin: null,
};

// ─────────────────────────────────────────────
// Custom SVG marker icons (no external files needed)
// ─────────────────────────────────────────────
function createIcon(color, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
    <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26S32 28 32 16C32 7.16 24.84 0 16 0z"
          fill="${color}" stroke="white" stroke-width="2.5"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.95"/>
    <text x="16" y="20" text-anchor="middle" font-size="9"
          font-weight="bold" fill="${color}" font-family="Arial,sans-serif">${label}</text>
  </svg>`;
  return L.divIcon({
    html:        svg,
    iconSize:    [32, 42],
    iconAnchor:  [16, 42],
    popupAnchor: [0, -44],
    className:   '',
  });
}

const pickupIcon = createIcon('#059669', 'A');
const destIcon   = createIcon('#dc2626', 'B');

// ─────────────────────────────────────────────
// Nominatim reverse geocode (browser → Nominatim directly)
// ─────────────────────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en' },
    });
    if (!res.ok) throw new Error('Nominatim error');
    const data = await res.json();
    if (data.error) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    const a = data.address || {};
    const parts = [
      a.road || a.pedestrian || a.footway || a.path,
      a.suburb || a.neighbourhood || a.quarter,
      a.city || a.town || a.village || a.county,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : data.display_name;
  } catch {
    return `${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}`;
  }
}

// ─────────────────────────────────────────────
// Nominatim forward geocode (text search → suggestions)
// ─────────────────────────────────────────────
async function geocodeSearch(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(r => ({
      lat:         parseFloat(r.lat),
      lng:         parseFloat(r.lon),
      displayName: r.display_name,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// OSRM route (browser → OSRM directly)
// Falls back to straight-line Haversine if OSRM fails
// ─────────────────────────────────────────────
async function getOSRMRoute(pLat, pLng, dLat, dLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pLng},${pLat};${dLng},${dLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM error');
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes.length) throw new Error('No route');
    const route = data.routes[0];
    return {
      distanceKm:  parseFloat((route.distance / 1000).toFixed(2)),
      durationMin: Math.ceil(route.duration / 60),
      polyline:    route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    };
  } catch (err) {
    console.warn('OSRM unavailable, using Haversine fallback:', err.message);
    const R   = 6371;
    const dLt = (dLat - pLat) * Math.PI / 180;
    const dLg = (dLng - pLng) * Math.PI / 180;
    const a   = Math.sin(dLt / 2) ** 2
              + Math.cos(pLat * Math.PI / 180) * Math.cos(dLat * Math.PI / 180)
              * Math.sin(dLg / 2) ** 2;
    const km  = parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.25).toFixed(2));
    return {
      distanceKm:  km,
      durationMin: Math.ceil(km * 2.5),
      polyline:    [[pLat, pLng], [dLat, dLng]],
    };
  }
}

// ─────────────────────────────────────────────
// Initialise the Leaflet map
// ─────────────────────────────────────────────
function initMap(containerId, defaultLat, defaultLng) {
  containerId  = containerId  || 'map';
  defaultLat   = defaultLat   || 17.385;
  defaultLng   = defaultLng   || 78.4867;

  if (typeof L === 'undefined') {
    setTimeout(() => initMap(containerId, defaultLat, defaultLng), 300);
    return;
  }

  map = L.map(containerId, {
    center:  [defaultLat, defaultLng],
    zoom:    13,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  // Critical: tell Leaflet to recalculate its size after layout is complete
  setTimeout(() => { if (map) map.invalidateSize(); }, 100);
  setTimeout(() => { if (map) map.invalidateSize(); }, 500);

  map.on('click', onMapClick);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        map.flyTo([pos.coords.latitude, pos.coords.longitude], 14, { duration: 1.2 });
      },
      function() {},
      { timeout: 6000 }
    );
  }

  setClickMode('pickup');
  return map;
}

// ─────────────────────────────────────────────
// Map click handler
// ─────────────────────────────────────────────
async function onMapClick(e) {
  var lat = e.latlng.lat;
  var lng = e.latlng.lng;
  var currentMode = clickMode;

  updateAddressField(currentMode, 'Getting address…');

  if (currentMode === 'pickup') {
    placePickupMarker(lat, lng);
    setClickMode('destination');
  } else {
    placeDestinationMarker(lat, lng);
  }

  var address = await reverseGeocode(lat, lng);

  if (currentMode === 'pickup') {
    window.mapState.pickup = { lat: lat, lng: lng, address: address };
    updateAddressField('pickup', address);
    var inp1 = document.getElementById('pickup-search');
    if (inp1) inp1.value = address;
  } else {
    window.mapState.destination = { lat: lat, lng: lng, address: address };
    updateAddressField('destination', address);
    var inp2 = document.getElementById('dest-search');
    if (inp2) inp2.value = address;
  }

  if (window.mapState.pickup && window.mapState.destination) {
    await drawRoute();
  }
}

// ─────────────────────────────────────────────
// Place / move markers
// ─────────────────────────────────────────────
function placePickupMarker(lat, lng) {
  if (pickupMarker) {
    pickupMarker.setLatLng([lat, lng]);
  } else {
    pickupMarker = L.marker([lat, lng], { icon: pickupIcon, draggable: true })
      .addTo(map)
      .bindPopup('<b>Pickup location (A)</b>');

    pickupMarker.on('dragend', async function(e) {
      var p = e.target.getLatLng();
      var address = await reverseGeocode(p.lat, p.lng);
      window.mapState.pickup = { lat: p.lat, lng: p.lng, address: address };
      updateAddressField('pickup', address);
      var inp = document.getElementById('pickup-search');
      if (inp) inp.value = address;
      if (window.mapState.destination) await drawRoute();
    });
  }
}

function placeDestinationMarker(lat, lng) {
  if (destMarker) {
    destMarker.setLatLng([lat, lng]);
  } else {
    destMarker = L.marker([lat, lng], { icon: destIcon, draggable: true })
      .addTo(map)
      .bindPopup('<b>Destination (B)</b>');

    destMarker.on('dragend', async function(e) {
      var p = e.target.getLatLng();
      var address = await reverseGeocode(p.lat, p.lng);
      window.mapState.destination = { lat: p.lat, lng: p.lng, address: address };
      updateAddressField('destination', address);
      var inp = document.getElementById('dest-search');
      if (inp) inp.value = address;
      if (window.mapState.pickup) await drawRoute();
    });
  }
}

// ─────────────────────────────────────────────
// Draw route
// ─────────────────────────────────────────────
async function drawRoute() {
  var p = window.mapState.pickup;
  var d = window.mapState.destination;
  if (!p || !d) return;

  showRouteInfo(null);

  var route = await getOSRMRoute(p.lat, p.lng, d.lat, d.lng);

  if (routeLayer) map.removeLayer(routeLayer);

  routeLayer = L.polyline(route.polyline, {
    color:   '#2563eb',
    weight:  5,
    opacity: 0.8,
    lineCap: 'round',
    lineJoin:'round',
  }).addTo(map);

  map.fitBounds(
    L.latLngBounds([[p.lat, p.lng], [d.lat, d.lng]]),
    { padding: [60, 60] }
  );

  window.mapState.distanceKm  = route.distanceKm;
  window.mapState.durationMin = route.durationMin;
  showRouteInfo(route);

  if (typeof onRouteReady === 'function') {
    onRouteReady(route.distanceKm, route.durationMin);
  }
}

// ─────────────────────────────────────────────
// Address search
// ─────────────────────────────────────────────
var _searchTimers = {};

async function onSearchInput(query, type) {
  clearTimeout(_searchTimers[type]);
  var dd = document.getElementById(type + '-suggestions');
  if (!dd) return;
  if (!query || query.trim().length < 3) { dd.style.display = 'none'; return; }

  _searchTimers[type] = setTimeout(async function() {
    var results = await geocodeSearch(query);
    if (results.length) {
      showSearchDropdown(type, results);
    } else {
      dd.style.display = 'none';
    }
  }, 400);
}

function showSearchDropdown(type, results) {
  var dd = document.getElementById(type + '-suggestions');
  if (!dd) return;
  dd.innerHTML = results.slice(0, 4).map(function(r) {
    var safe = r.displayName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return '<div class="suggestion-item" onclick="selectSuggestion(\'' + type + '\',' + r.lat + ',' + r.lng + ',\'' + safe.replace(/'/g, '&#39;') + '\')">📍 ' + r.displayName + '</div>';
  }).join('');
  dd.style.display = 'block';
}

function hideSearchDropdown(type) {
  var dd = document.getElementById(type + '-suggestions');
  if (dd) dd.style.display = 'none';
}

async function searchAddress(query, type) {
  if (!query || query.trim().length < 2) return;
  var results = await geocodeSearch(query);
  if (results.length) {
    await selectSuggestion(type, results[0].lat, results[0].lng, results[0].displayName);
  } else {
    showToast('No locations found. Try a different search.', 'warning');
  }
}

async function selectSuggestion(type, lat, lng, address) {
  map.flyTo([lat, lng], 15, { duration: 1.0 });

  if (type === 'pickup') {
    placePickupMarker(lat, lng);
    window.mapState.pickup = { lat: lat, lng: lng, address: address };
    updateAddressField('pickup', address);
    var inp1 = document.getElementById('pickup-search');
    if (inp1) inp1.value = address;
    setClickMode('destination');
  } else {
    placeDestinationMarker(lat, lng);
    window.mapState.destination = { lat: lat, lng: lng, address: address };
    updateAddressField('destination', address);
    var inp2 = document.getElementById('dest-search');
    if (inp2) inp2.value = address;
  }

  hideSearchDropdown(type);

  if (window.mapState.pickup && window.mapState.destination) {
    await drawRoute();
  }
}

// ─────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────
function setClickMode(mode) {
  clickMode = mode;

  var pickupInput = document.getElementById('pickup-search');
  var destInput   = document.getElementById('dest-search');
  if (pickupInput) pickupInput.style.borderColor = mode === 'pickup'      ? '#059669' : '';
  if (destInput)   destInput.style.borderColor   = mode === 'destination' ? '#dc2626' : '';

  var el = document.getElementById('map-instruction');
  if (el) {
    if (mode === 'pickup') {
      el.textContent = '📍 Click the map to set PICKUP location (A)';
      el.style.color = '#059669';
    } else {
      el.textContent = '🎯 Now click the map to set DESTINATION (B)';
      el.style.color = '#dc2626';
    }
  }
}

function updateAddressField(type, text) {
  var key = type === 'pickup' ? 'pickup' : 'destination';
  var el  = document.getElementById(key + '-address-display');
  if (el) {
    el.textContent = text;
    el.classList.remove('empty');
  }
}

function showRouteInfo(data) {
  var el = document.getElementById('route-info');
  if (!el) return;
  if (!data) {
    el.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:8px;vertical-align:middle"></span><span class="text-muted">Calculating route…</span>';
  } else {
    el.innerHTML = '<span>📏 <strong>' + data.distanceKm + ' km</strong></span><span style="margin:0 10px;color:var(--gray-300)">|</span><span>⏱ <strong>~' + data.durationMin + ' min</strong></span>';
  }
}

function resetMap() {
  if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
  if (destMarker)   { map.removeLayer(destMarker);   destMarker   = null; }
  if (routeLayer)   { map.removeLayer(routeLayer);   routeLayer   = null; }
  window.mapState = { pickup: null, destination: null, distanceKm: null, durationMin: null };
  var ri = document.getElementById('route-info');
  if (ri) ri.innerHTML = '<span class="text-muted" style="font-size:var(--font-size-sm)">Set both locations to see distance &amp; time</span>';
  setClickMode('pickup');
}
