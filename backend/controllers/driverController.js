// controllers/driverController.js
// Handles all driver-specific business logic:
//   - View and update driver profile (vehicle info)
//   - Toggle online / offline status (broadcasts via Socket.IO)
//   - Update GPS location (called from browser Geolocation API)
//   - Find nearby drivers within a radius (used by booking system)
//   - View driver public profile (used by customers)

const driverModel         = require('../models/driverModel');
const userModel           = require('../models/userModel');
const notificationService = require('../services/notificationService');
const matchingService     = require('../services/matchingService');
const bookingModel        = require('../models/bookingModel');
const { sendToUser, getIO } = require('../config/socket');

const driverController = {

  // ── GET /api/drivers/profile ─────────────────────────────────────────────
  // Returns the full profile for the currently logged-in driver.
  // Includes vehicle info, stats (rides, earnings, rating), and online status.
  async getProfile(req, res, next) {
    try {
      const driverProfile = await driverModel.findByUserId(req.user.id);

      if (!driverProfile) {
        return res.status(404).json({
          success: false,
          message: 'Driver profile not found.',
        });
      }

      return res.status(200).json({
        success: true,
        driver: {
          id:            driverProfile.id,
          userId:        driverProfile.user_id,
          name:          driverProfile.name,
          email:         driverProfile.email,
          phone:         driverProfile.phone,
          vehicleType:   driverProfile.vehicle_type,
          vehicleNumber: driverProfile.vehicle_number,
          vehicleModel:  driverProfile.vehicle_model,
          isOnline:      driverProfile.is_online,
          isAvailable:   driverProfile.is_available,
          latitude:      parseFloat(driverProfile.latitude),
          longitude:     parseFloat(driverProfile.longitude),
          avgRating:     parseFloat(driverProfile.avg_rating),
          totalRides:    driverProfile.total_rides,
          totalEarnings: parseFloat(driverProfile.total_earnings),
          updatedAt:     driverProfile.updated_at,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // ── PATCH /api/drivers/profile ───────────────────────────────────────────
  // Driver updates their vehicle information.
  // Body: { vehicleType, vehicleNumber, vehicleModel, name, phone }
  async updateProfile(req, res, next) {
    try {
      const { vehicleType, vehicleNumber, vehicleModel, name, phone } = req.body;

      // Update the base user info if provided
      if (name || phone) {
        await userModel.update(req.user.id, { name, phone });
      }

      // Update driver-specific vehicle info
      const updated = await driverModel.updateProfile(req.user.id, {
        vehicleType,
        vehicleNumber,
        vehicleModel,
      });

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Driver profile not found.',
        });
      }

      // Fetch the full updated profile to return complete data
      const fullProfile = await driverModel.findByUserId(req.user.id);

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        driver: {
          id:            fullProfile.id,
          name:          fullProfile.name,
          email:         fullProfile.email,
          phone:         fullProfile.phone,
          vehicleType:   fullProfile.vehicle_type,
          vehicleNumber: fullProfile.vehicle_number,
          vehicleModel:  fullProfile.vehicle_model,
          isOnline:      fullProfile.is_online,
          avgRating:     parseFloat(fullProfile.avg_rating),
          totalRides:    fullProfile.total_rides,
          totalEarnings: parseFloat(fullProfile.total_earnings),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // ── PATCH /api/drivers/status ────────────────────────────────────────────
  // Toggles driver online / offline.
  // Body: { isOnline: true | false }
  // When a driver goes online/offline, we broadcast this to all connected
  // clients via Socket.IO so customers and the admin can see live status.
  async updateStatus(req, res, next) {
    try {
      const { isOnline } = req.body;

      if (typeof isOnline !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isOnline must be a boolean (true or false).',
        });
      }

      const updated = await driverModel.setOnlineStatus(req.user.id, isOnline);

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found.',
        });
      }

      // Broadcast the status change to all connected Socket.IO clients
      const io = getIO();
      if (io) {
        io.emit('driver_status_changed', {
          driverId: updated.id,
          isOnline,
          updatedAt: updated.updated_at,
        });
      }

      // When driver goes ONLINE — send them any currently pending bookings nearby
      if (isOnline) {
        const driverProfile = await driverModel.findByUserId(req.user.id);
        if (
          driverProfile &&
          driverProfile.latitude  && parseFloat(driverProfile.latitude)  !== 0 &&
          driverProfile.longitude && parseFloat(driverProfile.longitude) !== 0
        ) {
          // Non-blocking — don't delay the response
          matchingService.dispatchPendingToDriver(
            req.user.id,
            parseFloat(driverProfile.latitude),
            parseFloat(driverProfile.longitude)
          ).catch(err => console.error('dispatchPending error:', err.message));
        }
      }

      return res.status(200).json({
        success: true,
        message: `You are now ${isOnline ? 'online' : 'offline'}.`,
        isOnline,
        updatedAt: updated.updated_at,
      });
    } catch (error) {
      next(error);
    }
  },

  // ── PATCH /api/drivers/location ──────────────────────────────────────────
  // Updates the driver's GPS coordinates.
  // Called periodically (every ~10 seconds) from the driver's browser
  // using the browser's navigator.geolocation API.
  // Body: { latitude, longitude }
  async updateLocation(req, res, next) {
    try {
      const { latitude, longitude } = req.body;

      // Validate coordinate ranges
      if (
        latitude  === undefined || longitude === undefined ||
        latitude  < -90  || latitude  > 90  ||
        longitude < -180 || longitude > 180
      ) {
        return res.status(400).json({
          success: false,
          message: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required.',
        });
      }

      const updated = await driverModel.updateLocation(
        req.user.id,
        parseFloat(latitude),
        parseFloat(longitude)
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found.',
        });
      }

      // Broadcast location update to all connected clients
      const io = getIO();
      if (io) {
        io.emit('driver_location_updated', {
          driverId:  updated.id,
          latitude:  parseFloat(updated.latitude),
          longitude: parseFloat(updated.longitude),
        });
      }

      // If this driver has an active ride, push location to the customer
      try {
        const activeBookings = await bookingModel.findByDriver(updated.id, 'ride_started');
        for (const booking of activeBookings) {
          // findByDriver returns customer_id on the booking row directly
          if (booking.customer_id) {
            notificationService.broadcastDriverLocation(booking.customer_id, {
              driverId:  updated.id,
              latitude:  parseFloat(updated.latitude),
              longitude: parseFloat(updated.longitude),
              bookingId: booking.id,
            });
          }
        }
      } catch (e) {
        // Silent — don't block the response if broadcast fails
        console.warn('Location broadcast error:', e.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Location updated.',
        latitude:  parseFloat(updated.latitude),
        longitude: parseFloat(updated.longitude),
      });
    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/drivers/stats ───────────────────────────────────────────────
  // Returns earnings and ride stats for the driver dashboard.
  async getStats(req, res, next) {
    try {
      const driverProfile = await driverModel.findByUserId(req.user.id);
      if (!driverProfile) {
        return res.status(404).json({ success: false, message: 'Driver profile not found.' });
      }

      const driverId = driverProfile.id;
      const pool     = require('../config/db');

      // Earnings: today, this week, all time
      const earningsQuery = `
        SELECT
          COALESCE(SUM(fare_amount) FILTER (
            WHERE completed_at::date = CURRENT_DATE
          ), 0)                                             AS today,
          COALESCE(SUM(fare_amount) FILTER (
            WHERE completed_at >= date_trunc('week', CURRENT_DATE)
          ), 0)                                             AS this_week,
          COALESCE(SUM(fare_amount) FILTER (
            WHERE completed_at >= date_trunc('month', CURRENT_DATE)
          ), 0)                                             AS this_month,
          COALESCE(SUM(fare_amount), 0)                     AS all_time,
          COUNT(*) FILTER (WHERE status = 'completed')      AS total_completed,
          COUNT(*) FILTER (WHERE status = 'cancelled'
            AND cancelled_by = 'driver')                    AS driver_cancelled
        FROM bookings
        WHERE driver_id = $1
      `;
      const earningsResult = await pool.query(earningsQuery, [driverId]);
      const earnings = earningsResult.rows[0];

      // Last 7 days: rides per day
      const weeklyQuery = `
        SELECT
          TO_CHAR(completed_at::date, 'Dy') AS day_label,
          completed_at::date                AS day_date,
          COUNT(*)                          AS ride_count,
          COALESCE(SUM(fare_amount), 0)     AS day_earnings
        FROM bookings
        WHERE driver_id = $1
          AND status = 'completed'
          AND completed_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY completed_at::date
        ORDER BY completed_at::date ASC
      `;
      const weeklyResult = await pool.query(weeklyQuery, [driverId]);

      // Fill in missing days with zeros
      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
        const found = weeklyResult.rows.find(r =>
          new Date(r.day_date).toISOString().split('T')[0] === dateStr
        );
        last7Days.push({
          date:     dateStr,
          label:    dayLabel,
          rides:    found ? parseInt(found.ride_count) : 0,
          earnings: found ? parseFloat(found.day_earnings) : 0,
        });
      }

      // Rating breakdown
      const ratingQuery = `
        SELECT
          COUNT(*)                               AS total,
          ROUND(AVG(rating)::numeric, 2)         AS avg,
          COUNT(*) FILTER (WHERE rating = 5)     AS five,
          COUNT(*) FILTER (WHERE rating = 4)     AS four,
          COUNT(*) FILTER (WHERE rating = 3)     AS three,
          COUNT(*) FILTER (WHERE rating <= 2)    AS low
        FROM ratings
        WHERE driver_id = $1
      `;
      const ratingResult = await pool.query(ratingQuery, [driverId]);
      const ratingStats = ratingResult.rows[0];

      return res.status(200).json({
        success: true,
        earnings: {
          today:      parseFloat(earnings.today)      || 0,
          thisWeek:   parseFloat(earnings.this_week)  || 0,
          thisMonth:  parseFloat(earnings.this_month) || 0,
          allTime:    parseFloat(earnings.all_time)   || 0,
          totalCompleted:   parseInt(earnings.total_completed)   || 0,
          driverCancelled:  parseInt(earnings.driver_cancelled)  || 0,
        },
        weeklyData: last7Days,
        ratings: {
          total:    parseInt(ratingStats.total)  || 0,
          avg:      parseFloat(ratingStats.avg)  || 0,
          fiveStar: parseInt(ratingStats.five)   || 0,
          fourStar: parseInt(ratingStats.four)   || 0,
          threeStar:parseInt(ratingStats.three)  || 0,
          lowStar:  parseInt(ratingStats.low)    || 0,
        },
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/drivers/nearby ──────────────────────────────────────────────
  // Find all online + available drivers within a given radius.
  // Query params: lat, lng, radius (default 30 km)
  // Used by the booking system to show available drivers to a customer.
  async getNearby(req, res, next) {
    try {
      const { lat, lng, radius } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: 'Latitude (lat) and longitude (lng) query parameters are required.',
        });
      }

      const latitude   = parseFloat(lat);
      const longitude  = parseFloat(lng);
      const radiusKm   = parseFloat(radius) || 30;

      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({
          success: false,
          message: 'lat and lng must be valid numbers.',
        });
      }

      const drivers = await driverModel.findNearby(latitude, longitude, radiusKm);

      // Map to a clean public-facing object (don't expose internal IDs unnecessarily)
      const driversPublic = drivers.map(d => ({
        id:            d.id,
        name:          d.name,
        vehicleType:   d.vehicle_type,
        vehicleModel:  d.vehicle_model,
        vehicleNumber: d.vehicle_number,
        avgRating:     parseFloat(d.avg_rating),
        totalRides:    d.total_rides,
        latitude:      parseFloat(d.latitude),
        longitude:     parseFloat(d.longitude),
        distanceKm:    parseFloat(d.distance_km).toFixed(2),
      }));

      return res.status(200).json({
        success: true,
        count:   driversPublic.length,
        drivers: driversPublic,
      });
    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/drivers/:id ─────────────────────────────────────────────────
  // Returns a driver's public profile by their driver ID.
  // Used by customers to see who their driver is after booking.
  async getById(req, res, next) {
    try {
      const { id } = req.params;

      const driver = await driverModel.findById(id);

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found.',
        });
      }

      return res.status(200).json({
        success: true,
        driver: {
          id:            driver.id,
          name:          driver.name,
          phone:         driver.phone,
          vehicleType:   driver.vehicle_type,
          vehicleNumber: driver.vehicle_number,
          vehicleModel:  driver.vehicle_model,
          avgRating:     parseFloat(driver.avg_rating),
          totalRides:    driver.total_rides,
          isOnline:      driver.is_online,
          latitude:      parseFloat(driver.latitude),
          longitude:     parseFloat(driver.longitude),
        },
      });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = driverController;
