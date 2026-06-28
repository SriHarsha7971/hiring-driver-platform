// services/mapService.js
// Server-side wrapper around free map APIs:
//   - Nominatim (OpenStreetMap) for geocoding and reverse geocoding
//   - OSRM for route calculation and distance
//
// Why do this server-side?
//   1. We can add caching later without changing the frontend
//   2. We control API keys if we upgrade to a paid provider
//   3. Nominatim's terms require a valid User-Agent header

const https = require('https');

// ─────────────────────────────────────────────
// Generic HTTPS GET helper (no external deps)
// ─────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        // Nominatim requires a descriptive User-Agent
        'User-Agent': 'RideHirePlatform/1.0 (learning-project)',
        'Accept':     'application/json',
      },
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

const mapService = {

  // ── Forward geocode: address string → { lat, lng, displayName } ──────────
  // Uses Nominatim (OpenStreetMap's free geocoding service)
  // Example: "MG Road, Hyderabad" → { lat: 17.385, lng: 78.487, displayName: "..." }
  async geocode(address) {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=5&addressdetails=1`;

    const results = await fetchJson(url);

    if (!results || results.length === 0) {
      return null;
    }

    // Return the top result formatted cleanly
    return results.map(r => ({
      lat:         parseFloat(r.lat),
      lng:         parseFloat(r.lon),
      displayName: r.display_name,
      type:        r.type,
      importance:  r.importance,
    }));
  },

  // ── Reverse geocode: { lat, lng } → address string ───────────────────────
  // Converts GPS coordinates to a human-readable address.
  // Called when a user clicks the map to set a location.
  async reverseGeocode(lat, lng) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;

    const result = await fetchJson(url);

    if (!result || result.error) {
      return {
        displayName: `${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}`,
        address:     {},
      };
    }

    // Build a short readable address from components
    const addr    = result.address || {};
    const parts   = [
      addr.road || addr.pedestrian || addr.footway,
      addr.suburb || addr.neighbourhood || addr.quarter,
      addr.city || addr.town || addr.village,
      addr.state,
    ].filter(Boolean);

    return {
      displayName: result.display_name,
      shortName:   parts.slice(0, 3).join(', ') || result.display_name,
      address:     addr,
    };
  },

  // ── Route calculation: two coordinate pairs → route geometry + distance ──
  // Uses OSRM (Open Source Routing Machine) — completely free, no key needed.
  // Returns the polyline coordinates for drawing the route on the map,
  // plus the total distance in km and estimated duration.
  async getRoute(pickupLat, pickupLng, destLat, destLng) {
    // OSRM expects coordinates as lng,lat (note the order!)
    const coords = `${pickupLng},${pickupLat};${destLng},${destLat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;

    const result = await fetchJson(url);

    if (!result || result.code !== 'Ok' || !result.routes || result.routes.length === 0) {
      throw new Error('Could not calculate route between these locations.');
    }

    const route = result.routes[0];

    return {
      // Distance in kilometres (OSRM returns metres)
      distanceKm:  parseFloat((route.distance / 1000).toFixed(2)),
      // Duration in minutes (OSRM returns seconds)
      durationMin: Math.ceil(route.duration / 60),
      // GeoJSON LineString coordinates for drawing on Leaflet
      // OSRM returns [lng, lat] pairs — we swap to [lat, lng] for Leaflet
      polyline: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    };
  },
};

module.exports = mapService;
