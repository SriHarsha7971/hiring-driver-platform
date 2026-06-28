// routes/fareRoutes.js
// Fare estimation endpoints.
// Both routes require authentication so anonymous users
// cannot probe the pricing engine.

const express        = require('express');
const router         = express.Router();
const fareController = require('../controllers/fareController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

// Calculate a fare estimate for a given distance + ride type
// POST /api/fare/estimate
// Body: { distanceKm, rideType, bookingTime? }
router.post('/estimate', fareController.estimate);

// Return the full rate card (base fares, tiers, surcharges)
// GET /api/fare/rates
router.get('/rates', fareController.getRates);

module.exports = router;
