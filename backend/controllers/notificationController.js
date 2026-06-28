// controllers/notificationController.js
// Thin controller — delegates to notificationModel for all DB work.

const notificationModel = require('../models/notificationModel');

const notificationController = {

  // ── GET /api/notifications ────────────────────────────────────────────────
  // Returns the most recent 30 notifications for the logged-in user.
  async getAll(req, res, next) {
    try {
      const limit       = parseInt(req.query.limit) || 30;
      const notifications = await notificationModel.findByUser(req.user.id, limit);

      return res.status(200).json({
        success: true,
        count:   notifications.length,
        notifications: notifications.map(n => ({
          id:        n.id,
          type:      n.type,
          title:     n.title,
          message:   n.message,
          data:      n.data || {},
          isRead:    n.is_read,
          createdAt: n.created_at,
        })),
      });
    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/notifications/unread-count ───────────────────────────────────
  // Returns just the unread badge count (called frequently by the UI).
  async getUnreadCount(req, res, next) {
    try {
      const count = await notificationModel.getUnreadCount(req.user.id);
      return res.status(200).json({ success: true, count });
    } catch (error) {
      next(error);
    }
  },

  // ── PATCH /api/notifications/:id/read ────────────────────────────────────
  async markRead(req, res, next) {
    try {
      const updated = await notificationModel.markRead(req.params.id, req.user.id);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Notification not found.' });
      }
      return res.status(200).json({ success: true, notification: updated });
    } catch (error) {
      next(error);
    }
  },

  // ── PATCH /api/notifications/read-all ────────────────────────────────────
  async markAllRead(req, res, next) {
    try {
      await notificationModel.markAllRead(req.user.id);
      return res.status(200).json({ success: true, message: 'All notifications marked as read.' });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = notificationController;
