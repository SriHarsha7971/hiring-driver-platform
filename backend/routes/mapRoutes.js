// routes/mapRoutes.js
// All map-related API routes.
// All routes require authentication to prevent anonymous abuse
// of the geocoding proxy.

const express       = require('express');
const router        = express.Router();
const mapController = require('../controllers/mapController');
const { authenticate } = require('../middleware/authMiddleware');

// All map routes require a valid JWT
router.use(authenticate);

// Forward geocode: text → coordinates
// GET /api/map/geocode?q=MG Road Hyderabad
router.get('/geocode', mapController.geocode);

// Reverse geocode: coordinates → address text
// GET /api/map/reverse?lat=17.38&lng=78.48
router.get('/reverse', mapController.reverseGeocode);

// Route calculation: two points → polyline + distance + duration
// GET /api/map/route?pickupLat=&pickupLng=&destLat=&destLng=
router.get('/route', mapController.getRoute);

module.exports = router;
