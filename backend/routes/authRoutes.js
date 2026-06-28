// routes/authRoutes.js
// Connects HTTP endpoints to controller functions.
// Public routes: /register, /login
// Protected routes: /me, /logout (require valid JWT)

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

// ── Public routes (no token needed) ──────────────────────────────
// Register a new account (customer or driver)
router.post('/register', authController.register);

// Login with email + password, receive JWT token
router.post('/login', authController.login);

// ── Protected routes (token required) ────────────────────────────
// Get the currently logged-in user's profile
router.get('/me', authenticate, authController.me);

// Logout (clears session server-side if needed in future)
router.post('/logout', authenticate, authController.logout);

module.exports = router;
