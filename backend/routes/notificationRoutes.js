// routes/notificationRoutes.js

const express                  = require('express');
const router                   = express.Router();
const notificationController   = require('../controllers/notificationController');
const { authenticate }         = require('../middleware/authMiddleware');

router.use(authenticate);

// Get unread count (called on page load for badge)
router.get('/unread-count', notificationController.getUnreadCount);

// Mark all as read
router.patch('/read-all', notificationController.markAllRead);

// Get all notifications
router.get('/', notificationController.getAll);

// Mark a single notification as read
router.patch('/:id/read', notificationController.markRead);

module.exports = router;
