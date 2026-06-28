// config/db.js
// Sets up a PostgreSQL connection pool using the 'pg' library.
// A pool reuses connections instead of opening a new one for every query,
// which is much more efficient for a web server.

const { Pool } = require('pg');
require('dotenv').config();

// Create a connection pool using environment variables
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Test the connection when the app starts
pool.connect((error, client, release) => {
  if (error) {
    console.error('❌ Database connection failed:', error.message);
    return;
  }
  console.log('✅ PostgreSQL connected successfully');
  release(); // Release client back to pool after test
});

// Export the pool so other files can run queries using pool.query(...)
module.exports = pool;
