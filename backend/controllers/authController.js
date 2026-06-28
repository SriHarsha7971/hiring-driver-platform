// controllers/authController.js
// Handles all authentication logic:
//   register → hash password → create user (+ driver profile) → return JWT
//   login    → find user → compare password → return JWT
//   me       → return current user from token
//
// Controllers receive req/res, call models for DB work, and send responses.
// They never write SQL directly.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const driverModel = require('../models/driverModel');
const { createError } = require('../middleware/errorHandler');

// Helper: create and sign a JWT token for a user
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

const authController = {

  // ── POST /api/auth/register ──────────────────────────────────────────────
  // Body: { name, email, phone, password, role, vehicleType, vehicleNumber, vehicleModel }
  // role must be 'customer' or 'driver'
  async register(req, res, next) {
    try {
      const {
        name, email, phone, password, role,
        vehicleType, vehicleNumber, vehicleModel,
      } = req.body;

      // ── Validation ──
      if (!name || !email || !password || !role) {
        return res.status(400).json({
          success: false,
          message: 'Name, email, password, and role are required.',
        });
      }

      if (!['customer', 'driver'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Role must be either "customer" or "driver".',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters.',
        });
      }

      // Email format check
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address.',
        });
      }

      // ── Check duplicate email ──
      const emailTaken = await userModel.emailExists(email.toLowerCase());
      if (emailTaken) {
        return res.status(409).json({
          success: false,
          message: 'An account with this email already exists.',
        });
      }

      // ── Hash the password ──
      // bcrypt salt rounds: 12 is secure and not too slow
      const passwordHash = await bcrypt.hash(password, 12);

      // ── Create the user row ──
      const newUser = await userModel.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone || null,
        passwordHash,
        role,
      });

      // ── If registering as a driver, create their driver profile ──
      let driverProfile = null;
      if (role === 'driver') {
        driverProfile = await driverModel.create({
          userId: newUser.id,
          vehicleType: vehicleType || 'sedan',
          vehicleNumber: vehicleNumber || null,
          vehicleModel: vehicleModel || null,
        });
      }

      // ── Generate JWT ──
      const token = generateToken(newUser);

      // ── Send response ──
      return res.status(201).json({
        success: true,
        message: `Welcome to RideHire, ${newUser.name}!`,
        token,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
          createdAt: newUser.created_at,
        },
        ...(driverProfile && { driverProfile }),
      });

    } catch (error) {
      next(error);
    }
  },

  // ── POST /api/auth/login ─────────────────────────────────────────────────
  // Body: { email, password }
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // ── Validation ──
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required.',
        });
      }

      // ── Find user by email (includes password_hash) ──
      const user = await userModel.findByEmail(email.toLowerCase().trim());
      if (!user) {
        // Use same message for both "not found" and "wrong password"
        // so attackers can't determine which emails are registered
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.',
        });
      }

      // ── Compare password against stored hash ──
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.',
        });
      }

      // ── Fetch driver profile if user is a driver ──
      let driverProfile = null;
      if (user.role === 'driver') {
        driverProfile = await driverModel.findByUserId(user.id);
      }

      // ── Generate JWT ──
      const token = generateToken(user);

      return res.status(200).json({
        success: true,
        message: `Welcome back, ${user.name}!`,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          createdAt: user.created_at,
        },
        ...(driverProfile && { driverProfile }),
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  // Protected: requires valid JWT token in Authorization header
  // Returns the current user's profile
  async me(req, res, next) {
    try {
      // req.user is set by the authenticate middleware
      const user = await userModel.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.',
        });
      }

      let driverProfile = null;
      if (user.role === 'driver') {
        driverProfile = await driverModel.findByUserId(user.id);
      }

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          createdAt: user.created_at,
        },
        ...(driverProfile && { driverProfile }),
      });

    } catch (error) {
      next(error);
    }
  },

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  // JWT is stateless — logout is handled on the frontend by deleting the token.
  // This endpoint exists for completeness and future token blacklisting.
  async logout(req, res) {
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  },
};

module.exports = authController;
