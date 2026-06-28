// controllers/fareController.js
// Receives and validates fare estimation requests,
// then delegates calculation to fareService.js.
// Keeps controllers thin — no pricing logic here.

const fareService = require('../services/fareService');

const fareController = {

  // ── POST /api/fare/estimate ──────────────────────────────────────────────
  // Body: { distanceKm, rideType, bookingTime? }
  // Returns a complete fare breakdown the customer sees before confirming.
  async estimate(req, res, next) {
    try {
      const { distanceKm, rideType, bookingTime, tripType, tripDuration } = req.body;

      if (!rideType || !['taxi', 'personal_driver'].includes(rideType)) {
        return res.status(400).json({
          success: false,
          message: 'rideType must be "taxi" or "personal_driver".',
        });
      }

      // For hourly/daily, distanceKm is optional (set to 0)
      const km = parseFloat(distanceKm) || 0;

      if (km > 500) {
        return res.status(400).json({
          success: false,
          message: 'Distance cannot exceed 500 km.',
        });
      }

      const type     = tripType     || 'one_way';
      const duration = tripDuration ? parseFloat(tripDuration) : null;

      if (!['one_way', 'hourly', 'daily'].includes(type)) {
        return res.status(400).json({
          success: false,
          message: 'tripType must be "one_way", "hourly", or "daily".',
        });
      }

      const bookingDate = bookingTime ? new Date(bookingTime) : new Date();
      if (isNaN(bookingDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'bookingTime must be a valid ISO date string.',
        });
      }

      const fareResult = fareService.calculate(km, rideType, bookingDate, type, duration);

      return res.status(200).json({
        success: true,
        fare:    fareResult,
      });

    } catch (error) {
      if (error.message.includes('ride type') || error.message.includes('Distance')) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // ── GET /api/fare/rates ──────────────────────────────────────────────────
  // Returns the current rate card so the frontend can show pricing info.
  // No body needed — just GET and display.
  getRates(req, res) {
    const pricing   = fareService.getPricing();
    const surcharges = fareService.getSurcharges();

    return res.status(200).json({
      success: true,
      rates: {
        taxi: {
          baseFare:    pricing.taxi.baseFare,
          minimumFare: pricing.taxi.minimumFare,
          tiers:       pricing.taxi.tiers,
        },
        personal_driver: {
          baseFare:    pricing.personal_driver.baseFare,
          minimumFare: pricing.personal_driver.minimumFare,
          tiers:       pricing.personal_driver.tiers,
        },
      },
      surcharges: surcharges.map(s => ({
        name:       s.name,
        startHour:  s.startHour,
        endHour:    s.endHour > 23 ? s.endHour - 24 : s.endHour,
        percentage: Math.round((s.multiplier - 1) * 100),
      })),
    });
  },
};

module.exports = fareController;
