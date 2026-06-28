// models/userModel.js
// All database queries related to the users table.
// Controllers call these functions — they never write raw SQL themselves.
// This keeps database logic in one place and easy to change.

const pool = require('../config/db');

const userModel = {

  // Create a new user row and return the created record
  async create({ name, email, phone, passwordHash, role }) {
    const query = `
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, email, phone, role, created_at
    `;
    const values = [name, email, phone || null, passwordHash, role];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Find a user by their email address (used during login)
  async findByEmail(email) {
    const query = `
      SELECT id, name, email, phone, password_hash, role, created_at
      FROM users
      WHERE email = $1
    `;
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
  },

  // Find a user by their ID (used to verify JWT tokens)
  async findById(id) {
    const query = `
      SELECT id, name, email, phone, role, created_at
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  // Check if an email is already registered
  async emailExists(email) {
    const query = `SELECT id FROM users WHERE email = $1`;
    const result = await pool.query(query, [email]);
    return result.rows.length > 0;
  },

  // Update user profile fields
  async update(id, { name, phone }) {
    const query = `
      UPDATE users
      SET name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          updated_at = NOW()
      WHERE id = $3
      RETURNING id, name, email, phone, role, updated_at
    `;
    const result = await pool.query(query, [name, phone, id]);
    return result.rows[0] || null;
  },
};

module.exports = userModel;
