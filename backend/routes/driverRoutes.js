// routes/driverRoutes.js
// All driver-related API endpoints.
// Every route here requires authentication.
// Role-specific routes additionally require authorize('driver').

const express = require('express');
const router  = express.Router();
const driverController = require('../controllers/driverController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// All routes below require a valid JWT token
router.use(authenticate);

// ── Driver-only routes ─────────────────────────────────────────────────────

// Get the logged-in driver's own full profile + stats
router.get('/profile', authorize('driver'), driverController.getProfile);

// Get driver earnings + weekly chart data for dashboard
router.get('/stats', authorize('driver'), driverController.getStats);

// Update vehicle info and personal details
router.patch('/profile', authorize('driver'), driverController.updateProfile);

// Toggle online / offline availability
router.patch('/status', authorize('driver'), driverController.updateStatus);

// Update current GPS location (called on an interval from the browser)
router.patch('/location', authorize('driver'), driverController.updateLocation);

// ── Customer-accessible routes ─────────────────────────────────────────────

// Find all online drivers near a lat/lng point within a radius
// Query: ?lat=17.38&lng=78.48&radius=30
router.get('/nearby', driverController.getNearby);

// Get a specific driver's public profile by their driver ID
router.get('/:id', driverController.getById);

module.exports = router;
