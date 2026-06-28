// models/bookingModel.js
// All database queries for the bookings table.
// Keeps raw SQL out of controllers.

const pool = require('../config/db');

const bookingModel = {

  // ── Create a new booking row ─────────────────────────────────────────────
  async create({
    customerId, rideType,
    tripType, tripDuration,
    carModel, carNumber, carColor, specialInstructions,
    pickupAddress, destinationAddress,
    pickupLat, pickupLng,
    destinationLat, destinationLng,
    distanceKm, fareAmount,
  }) {
    const query = `
      INSERT INTO bookings (
        customer_id, ride_type,
        trip_type, trip_duration,
        car_model, car_number, car_color, special_instructions,
        pickup_address, destination_address,
        pickup_lat, pickup_lng,
        destination_lat, destination_lng,
        distance_km, fare_amount,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending')
      RETURNING *
    `;
    const values = [
      customerId, rideType,
      tripType    || 'one_way',
      tripDuration || null,
      carModel    || null,
      carNumber   || null,
      carColor    || null,
      specialInstructions || null,
      pickupAddress,
      destinationAddress  || null,
      pickupLat, pickupLng,
      destinationLat || null,
      destinationLng || null,
      distanceKm || 0,
      fareAmount,
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // ── Find booking by ID with joined customer + driver names ───────────────
  async findById(id) {
    const query = `
      SELECT
        b.*,
        cu.name  AS customer_name,
        cu.phone AS customer_phone,
        du.id    AS driver_user_id,
        du.name  AS driver_name,
        du.phone AS driver_phone,
        d.vehicle_type,
        d.vehicle_number,
        d.vehicle_model,
        d.avg_rating AS driver_avg_rating
      FROM bookings b
      JOIN users cu ON cu.id = b.customer_id
      LEFT JOIN drivers d  ON d.id = b.driver_id
      LEFT JOIN users  du  ON du.id = d.user_id
      WHERE b.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  // ── All bookings for a customer ──────────────────────────────────────────
  async findByCustomer(customerId, status = null) {
    let query = `
      SELECT
        b.*,
        du.name  AS driver_name,
        du.phone AS driver_phone,
        d.vehicle_type,
        d.vehicle_number,
        d.vehicle_model,
        d.avg_rating AS driver_avg_rating
      FROM bookings b
      LEFT JOIN drivers d  ON d.id = b.driver_id
      LEFT JOIN users  du  ON du.id = d.user_id
      WHERE b.customer_id = $1
    `;
    const values = [customerId];
    if (status) {
      query += ` AND b.status = $2`;
      values.push(status);
    }
    query += ` ORDER BY b.created_at DESC`;
    const result = await pool.query(query, values);
    return result.rows;
  },

  // ── All bookings for a driver ────────────────────────────────────────────
  async findByDriver(driverId, status = null) {
    let query = `
      SELECT
        b.*,
        cu.name  AS customer_name,
        cu.phone AS customer_phone
      FROM bookings b
      JOIN users cu ON cu.id = b.customer_id
      WHERE b.driver_id = $1
    `;
    const values = [driverId];
    if (status) {
      query += ` AND b.status = $2`;
      values.push(status);
    }
    query += ` ORDER BY b.created_at DESC`;
    const result = await pool.query(query, values);
    return result.rows;
  },

  // ── Find all pending bookings near a location (for driver matching) ──────
  // Find all pending bookings near a location (for driver matching)
  async findPendingNearby(lat, lng, radiusKm = 30) {
    const query = `
      SELECT *
      FROM (
        SELECT
          b.*,
          cu.name AS customer_name,
          (
            6371 * acos(
              LEAST(1.0,
                cos(radians($1)) * cos(radians(b.pickup_lat)) *
                cos(radians(b.pickup_lng) - radians($2)) +
                sin(radians($1)) * sin(radians(b.pickup_lat))
              )
            )
          ) AS distance_to_pickup_km
        FROM bookings b
        JOIN users cu ON cu.id = b.customer_id
        WHERE b.status = 'pending'
      ) AS nearby
      WHERE nearby.distance_to_pickup_km <= $3
      ORDER BY nearby.distance_to_pickup_km ASC
    `;
    const result = await pool.query(query, [
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radiusKm),
    ]);
    return result.rows;
  },

  // ── Update booking status ────────────────────────────────────────────────
  // Valid transitions enforced in the controller.
  async updateStatus(id, status, driverId = null) {
    // Build timestamp column name for this status
    const timestampCol = {
      accepted:        'accepted_at',
      ride_started:    'started_at',
      completed:       'completed_at',
    }[status];

    let query;
    let values;

    if (driverId && status === 'accepted') {
      // Assign driver when accepting
      query = `
        UPDATE bookings
        SET status = $1,
            driver_id = $2,
            ${timestampCol ? `${timestampCol} = NOW(),` : ''}
            updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;
      // Remove trailing comma if no timestamp col (shouldn't happen for accepted)
      query = query.replace(/,\s*updated_at/, ', updated_at');
      values = [status, driverId, id];
    } else {
      query = `
        UPDATE bookings
        SET status = $1
            ${timestampCol ? `, ${timestampCol} = NOW()` : ''}
            , updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;
      values = [status, id];
    }

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  },

  // ── Cancel a booking ─────────────────────────────────────────────────────
  async cancel(id, cancelledBy, reason = null) {
    const query = `
      UPDATE bookings
      SET status       = 'cancelled',
          cancelled_by = $1,
          cancel_reason = $2,
          updated_at   = NOW()
      WHERE id = $3
        AND status NOT IN ('completed', 'cancelled')
      RETURNING *
    `;
    const result = await pool.query(query, [cancelledBy, reason, id]);
    return result.rows[0] || null;
  },

  // ── Check if a rating exists for a booking ───────────────────────────────
  async hasRating(bookingId) {
    const result = await pool.query(
      `SELECT id FROM ratings WHERE booking_id = $1`,
      [bookingId]
    );
    return result.rows.length > 0;
  },
};

module.exports = bookingModel;
