// controllers/mapController.js
// Thin controller layer that receives HTTP requests and delegates
// all the actual map logic to mapService.js.
// Every route here requires authentication so anonymous users
// cannot abuse our geocoding proxy.

const mapService = require('../services/mapService');

const mapController = {

  // ── GET /api/map/geocode?q=MG+Road+Hyderabad ─────────────────────────────
  // Converts a text query into one or more lat/lng results.
  // The frontend uses this for the address search autocomplete box.
  async geocode(req, res, next) {
    try {
      const { q } = req.query;

      if (!q || q.trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Search query (q) must be at least 3 characters.',
        });
      }

      const results = await mapService.geocode(q.trim());

      if (!results || results.length === 0) {
        return res.status(200).json({
          success: true,
          results: [],
          message: 'No locations found for that search.',
        });
      }

      return res.status(200).json({
        success: true,
        results,
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/map/reverse?lat=17.38&lng=78.48 ─────────────────────────────
  // Converts GPS coordinates into a human-readable address string.
  // Called when a user clicks on the map to set pickup / destination.
  async reverseGeocode(req, res, next) {
    try {
      const { lat, lng } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: 'Both lat and lng query parameters are required.',
        });
      }

      const latitude  = parseFloat(lat);
      const longitude = parseFloat(lng);

      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({
          success: false,
          message: 'lat and lng must be valid numbers.',
        });
      }

      const result = await mapService.reverseGeocode(latitude, longitude);

      return res.status(200).json({
        success: true,
        lat:         latitude,
        lng:         longitude,
        displayName: result.displayName,
        shortName:   result.shortName || result.displayName,
        address:     result.address,
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/map/route?pickupLat=...&pickupLng=...&destLat=...&destLng=... ─
  // Calculates the driving route between two coordinate pairs.
  // Returns: distance (km), duration (minutes), and polyline for map drawing.
  async getRoute(req, res, next) {
    try {
      const { pickupLat, pickupLng, destLat, destLng } = req.query;

      if (!pickupLat || !pickupLng || !destLat || !destLng) {
        return res.status(400).json({
          success: false,
          message: 'pickupLat, pickupLng, destLat, and destLng are all required.',
        });
      }

      const pLat = parseFloat(pickupLat);
      const pLng = parseFloat(pickupLng);
      const dLat = parseFloat(destLat);
      const dLng = parseFloat(destLng);

      if ([pLat, pLng, dLat, dLng].some(isNaN)) {
        return res.status(400).json({
          success: false,
          message: 'All coordinate parameters must be valid numbers.',
        });
      }

      const route = await mapService.getRoute(pLat, pLng, dLat, dLng);

      return res.status(200).json({
        success:     true,
        distanceKm:  route.distanceKm,
        durationMin: route.durationMin,
        // Polyline is an array of [lat, lng] pairs used by Leaflet.polyline()
        polyline:    route.polyline,
      });

    } catch (error) {
      next(error);
    }
  },
};

module.exports = mapController;
