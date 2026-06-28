// models/notificationModel.js
// All database queries for the notifications table.
// Notifications are created server-side whenever a meaningful event
// occurs (booking status change, new request, cancellation, etc.)
// and are delivered both via Socket.IO (real-time) and stored here
// (persistent — user can view them later even after reconnecting).

const pool = require('../config/db');

const notificationModel = {

  // ── Create a new notification ────────────────────────────────────────────
  async create({ userId, type, title, message, data = {} }) {
    const query = `
      INSERT INTO notifications (user_id, type, title, message, data)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await pool.query(query, [
      userId,
      type,
      title,
      message,
      JSON.stringify(data),
    ]);
    return result.rows[0];
  },

  // ── Get all notifications for a user (newest first) ──────────────────────
  async findByUser(userId, limit = 30) {
    const query = `
      SELECT *
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);
    return result.rows;
  },

  // ── Get unread count for a user ──────────────────────────────────────────
  async getUnreadCount(userId) {
    const query = `
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = $1 AND is_read = false
    `;
    const result = await pool.query(query, [userId]);
    return parseInt(result.rows[0].count, 10);
  },

  // ── Mark a single notification as read ───────────────────────────────────
  async markRead(id, userId) {
    const query = `
      UPDATE notifications
      SET is_read = true
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [id, userId]);
    return result.rows[0] || null;
  },

  // ── Mark all notifications as read for a user ────────────────────────────
  async markAllRead(userId) {
    const query = `
      UPDATE notifications
      SET is_read = true
      WHERE user_id = $1 AND is_read = false
    `;
    await pool.query(query, [userId]);
  },

  // ── Delete notifications older than N days (cleanup) ────────────────────
  async deleteOld(daysOld = 30) {
    const query = `
      DELETE FROM notifications
      WHERE created_at < NOW() - INTERVAL '${daysOld} days'
    `;
    const result = await pool.query(query);
    return result.rowCount;
  },
};

module.exports = notificationModel;
