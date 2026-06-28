// routes/ratingRoutes.js
// Rating endpoints — all require authentication.

const express          = require('express');
const router           = express.Router();
const ratingController = require('../controllers/ratingController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.use(authenticate);

// Submit a rating (customers only)
router.post('/', authorize('customer'), ratingController.create);

// Get all ratings the customer has given
router.get('/my', authorize('customer'), ratingController.getMy);

// Get a rating for a specific booking
router.get('/booking/:bookingId', ratingController.getByBooking);

// Get all ratings + stats for a driver
router.get('/driver/:driverId', ratingController.getByDriver);

module.exports = router;
