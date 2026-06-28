// models/driverModel.js
// All database queries for the drivers table.
// A driver is a user with role='driver' PLUS a row in this table
// that holds vehicle info, location, and availability status.

const pool = require('../config/db');

const driverModel = {

  // Create a driver profile (called right after a driver registers)
  async create({ userId, vehicleType, vehicleNumber, vehicleModel }) {
    const query = `
      INSERT INTO drivers (user_id, vehicle_type, vehicle_number, vehicle_model)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [userId, vehicleType || 'sedan', vehicleNumber || null, vehicleModel || null];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Get driver profile by their user_id (the FK linking to users table)
  async findByUserId(userId) {
    const query = `
      SELECT d.*, u.name, u.email, u.phone
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      WHERE d.user_id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  },

  // Get driver profile by their drivers table primary key
  async findById(id) {
    const query = `
      SELECT d.*, u.name, u.email, u.phone
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      WHERE d.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  // Update driver's vehicle and profile info
  async updateProfile(userId, { vehicleType, vehicleNumber, vehicleModel }) {
    const query = `
      UPDATE drivers
      SET vehicle_type   = COALESCE($1, vehicle_type),
          vehicle_number = COALESCE($2, vehicle_number),
          vehicle_model  = COALESCE($3, vehicle_model),
          updated_at     = NOW()
      WHERE user_id = $4
      RETURNING *
    `;
    const result = await pool.query(query, [vehicleType, vehicleNumber, vehicleModel, userId]);
    return result.rows[0] || null;
  },

  // Toggle driver online / offline status
  // Set driver availability (false = busy on a ride, true = free to accept)
  async setAvailability(userId, isAvailable) {
    const result = await pool.query(
      `UPDATE drivers SET is_available = $1, updated_at = NOW()
       WHERE user_id = $2 RETURNING *`,
      [isAvailable, userId]
    );
    return result.rows[0] || null;
  },

  // Check whether this driver already has an active ride
  // (accepted / driver_arriving / ride_started)
  async hasActiveRide(driverId) {
    const result = await pool.query(
      `SELECT id FROM bookings
       WHERE driver_id = $1
         AND status IN ('accepted', 'driver_arriving', 'ride_started')
       LIMIT 1`,
      [driverId]
    );
    return result.rows.length > 0;
  },

  async setOnlineStatus(userId, isOnline) {
    const query = `
      UPDATE drivers
      SET is_online = $1, updated_at = NOW()
      WHERE user_id = $2
      RETURNING id, is_online, updated_at
    `;
    const result = await pool.query(query, [isOnline, userId]);
    return result.rows[0] || null;
  },

  // Update driver GPS location (called periodically from the frontend)
  async updateLocation(userId, latitude, longitude) {
    const query = `
      UPDATE drivers
      SET latitude = $1, longitude = $2, updated_at = NOW()
      WHERE user_id = $3
      RETURNING id, latitude, longitude
    `;
    const result = await pool.query(query, [latitude, longitude, userId]);
    return result.rows[0] || null;
  },

  // Find all online drivers within a radius (uses Haversine formula in SQL)
  // Returns drivers sorted by distance ascending.
  // Uses a subquery to avoid the HAVING-without-GROUP-BY PostgreSQL error.
  async findNearby(lat, lng, radiusKm = 30) {
    const query = `
      SELECT *
      FROM (
        SELECT
          d.*,
          u.name, u.email, u.phone,
          (
            6371 * acos(
              LEAST(1.0,
                cos(radians($1)) * cos(radians(d.latitude)) *
                cos(radians(d.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(d.latitude))
              )
            )
          ) AS distance_km
        FROM drivers d
        JOIN users u ON u.id = d.user_id
        WHERE d.is_online = true
          AND d.is_available = true
          AND d.latitude  IS NOT NULL
          AND d.longitude IS NOT NULL
          AND d.latitude  != 0
          AND d.longitude != 0
      ) AS nearby
      WHERE nearby.distance_km <= $3
      ORDER BY nearby.distance_km ASC
    `;
    const result = await pool.query(query, [
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radiusKm),
    ]);
    return result.rows;
  },

  // Recalculate and update the driver's average rating
  async recalculateRating(driverId) {
    const query = `
      UPDATE drivers
      SET avg_rating = (
        SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)
        FROM ratings
        WHERE driver_id = $1
      ),
      updated_at = NOW()
      WHERE id = $1
      RETURNING id, avg_rating
    `;
    const result = await pool.query(query, [driverId]);
    return result.rows[0] || null;
  },

  // Increment total rides and earnings after a completed ride
  async incrementStats(driverId, fareAmount) {
    const query = `
      UPDATE drivers
      SET total_rides    = total_rides + 1,
          total_earnings = total_earnings + $1,
          updated_at     = NOW()
      WHERE id = $2
      RETURNING id, total_rides, total_earnings
    `;
    const result = await pool.query(query, [fareAmount, driverId]);
    return result.rows[0] || null;
  },
};

module.exports = driverModel;
