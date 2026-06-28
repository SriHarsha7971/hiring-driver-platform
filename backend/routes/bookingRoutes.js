// routes/bookingRoutes.js
// All booking lifecycle endpoints.
// Every route requires authentication.

const express           = require('express');
const router            = express.Router();
const bookingController = require('../controllers/bookingController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.use(authenticate);

// Create a new booking (customer only)
router.post('/', authorize('customer'), bookingController.create);

// Get all bookings for the logged-in user (customer or driver)
router.get('/my', bookingController.getMyBookings);

// Get a single booking by ID
router.get('/:id', bookingController.getById);

// Get full status transition history for a booking
router.get('/:id/status-history', bookingController.statusHistory);

// Get driver ETA to pickup point
router.get('/:id/eta', bookingController.getETA);

// Poll matching status (customer)
router.get('/:id/match-status', bookingController.matchStatus);

// Driver: accept a ride request
router.post('/:id/accept', authorize('driver'), bookingController.accept);

// Driver: reject a ride request
router.post('/:id/reject', authorize('driver'), bookingController.reject);

// Driver updates the ride status
router.patch('/:id/status', authorize('driver'), bookingController.updateStatus);

// Cancel a booking (customer or driver)
router.post('/:id/cancel', bookingController.cancel);

module.exports = router;
