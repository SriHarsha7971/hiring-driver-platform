// config/migrate.js
// Run this script once to create all database tables.
// Command: node config/migrate.js
//
// Uses IF NOT EXISTS so it's safe to run multiple times.

const pool = require('./db');

async function runMigrations() {
  console.log('🚀 Starting database migration...');

  try {
    // Enable the uuid-ossp extension so we can use gen_random_uuid()
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // =============================================
    // TABLE 1: users
    // Stores both customers and drivers.
    // Role field distinguishes between them.
    // =============================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(100) NOT NULL,
        email       VARCHAR(150) UNIQUE NOT NULL,
        phone       VARCHAR(20),
        password_hash VARCHAR(255) NOT NULL,
        role        VARCHAR(20) NOT NULL CHECK (role IN ('customer', 'driver')),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✅ Table "users" ready');

    // =============================================
    // TABLE 2: drivers
    // Extended profile for users who are drivers.
    // Stores vehicle info, location, and online status.
    // =============================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vehicle_type    VARCHAR(50) DEFAULT 'sedan',
        vehicle_number  VARCHAR(20),
        vehicle_model   VARCHAR(100),
        latitude        DECIMAL(10, 8) DEFAULT 0,
        longitude       DECIMAL(11, 8) DEFAULT 0,
        is_online       BOOLEAN DEFAULT false,
        is_available    BOOLEAN DEFAULT true,
        avg_rating      DECIMAL(3, 2) DEFAULT 0.00,
        total_rides     INTEGER DEFAULT 0,
        total_earnings  DECIMAL(10, 2) DEFAULT 0.00,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✅ Table "drivers" ready');

    // =============================================
    // TABLE 3: bookings
    // The core table. Tracks every ride from request to completion.
    // Status field follows the booking workflow state machine.
    // =============================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        driver_id           UUID REFERENCES drivers(id) ON DELETE SET NULL,
        ride_type           VARCHAR(20) NOT NULL CHECK (ride_type IN ('personal_driver', 'taxi')),
        -- Personal driver extra fields
        trip_type           VARCHAR(20) DEFAULT 'one_way'
                            CHECK (trip_type IN ('one_way', 'hourly', 'daily')),
        trip_duration       DECIMAL(6, 2) DEFAULT NULL,
        car_model           VARCHAR(100) DEFAULT NULL,
        car_number          VARCHAR(30)  DEFAULT NULL,
        car_color           VARCHAR(50)  DEFAULT NULL,
        special_instructions TEXT        DEFAULT NULL,
        -- Location
        pickup_address      TEXT NOT NULL,
        destination_address TEXT,
        pickup_lat          DECIMAL(10, 8) NOT NULL,
        pickup_lng          DECIMAL(11, 8) NOT NULL,
        destination_lat     DECIMAL(10, 8),
        destination_lng     DECIMAL(11, 8),
        distance_km         DECIMAL(8, 2),
        fare_amount         DECIMAL(10, 2),
        status              VARCHAR(30) NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                              'pending',
                              'accepted',
                              'driver_arriving',
                              'ride_started',
                              'completed',
                              'cancelled'
                            )),
        cancelled_by        VARCHAR(20) CHECK (cancelled_by IN ('customer', 'driver', 'system')),
        cancel_reason       TEXT,
        created_at          TIMESTAMP DEFAULT NOW(),
        accepted_at         TIMESTAMP,
        started_at          TIMESTAMP,
        completed_at        TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✅ Table "bookings" ready');

    // =============================================
    // TABLE 4: ratings
    // After ride completion, customers rate drivers.
    // One rating per booking (enforced by UNIQUE constraint).
    // =============================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id  UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        driver_id   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
        rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment     TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✅ Table "ratings" ready');

    // =============================================
    // TABLE 6: ride_status_history
    // Logs every status transition for audit trail.
    // =============================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ride_status_history (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        from_status VARCHAR(30),
        to_status   VARCHAR(30) NOT NULL,
        changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
        actor_role  VARCHAR(20),
        note        TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✅ Table "ride_status_history" ready');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type       VARCHAR(50)  NOT NULL,
        title      VARCHAR(200) NOT NULL,
        message    TEXT         NOT NULL,
        data       JSONB        DEFAULT '{}',
        is_read    BOOLEAN      DEFAULT false,
        created_at TIMESTAMP    DEFAULT NOW()
      );
    `);
    console.log('  ✅ Table "notifications" ready');

    // =============================================
    // INDEXES: Speed up common queries
    // =============================================
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_customer_id      ON bookings(customer_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_driver_id        ON bookings(driver_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_status           ON bookings(status);
      CREATE INDEX IF NOT EXISTS idx_drivers_is_online         ON drivers(is_online);
      CREATE INDEX IF NOT EXISTS idx_ratings_driver_id         ON ratings(driver_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id     ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read     ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_status_history_booking_id ON ride_status_history(booking_id);
    `);
    console.log('  ✅ Indexes created');

    console.log('\n🎉 All migrations completed successfully!');
    console.log('📋 Tables: users, drivers, bookings, ratings, notifications, ride_status_history');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
  } finally {
    await pool.end(); // Close the pool connection after migration
    process.exit(0);
  }
}

runMigrations();
