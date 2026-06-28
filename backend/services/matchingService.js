// services/matchingService.js
// Driver matching engine.
//
// Key design decisions:
//   1. Broadcast to ALL nearby online drivers simultaneously (not sequential).
//   2. First driver to accept wins. Others get a "ride taken" notification.
//   3. NEVER auto-cancel a booking just because no one accepted quickly —
//      leave it as "pending" so drivers who come online later can see it.
//   4. The timeout only sends a notification to the customer; it does NOT
//      cancel the booking. Only explicit cancel actions cancel bookings.

const driverModel  = require('../models/driverModel');
const bookingModel = require('../models/bookingModel');
const { sendToUser, getIO } = require('../config/socket');

// In-memory state per booking
const matchingState = new Map();

const NOTIFY_TIMEOUT_SECONDS = 120; // 2 min — notify customer if still pending
const MAX_RADIUS_KM          = 30;

function scoreDriver(driver, distanceKm) {
  const proximityScore  = Math.max(0, (1 - distanceKm / MAX_RADIUS_KM)) * 50;
  const ratingScore     = (parseFloat(driver.avg_rating) || 0) / 5 * 30;
  const experienceScore = Math.min((parseInt(driver.total_rides) || 0) / 50, 1) * 20;
  return parseFloat((proximityScore + ratingScore + experienceScore).toFixed(2));
}

const matchingService = {

  async findAndDispatch(bookingId, pickupLat, pickupLng) {
    try {
      // Re-fetch booking to get fresh status + customer info
      const booking = await bookingModel.findById(bookingId);
      if (!booking || booking.status !== 'pending') return;

      const candidates = await driverModel.findNearby(
        parseFloat(pickupLat),
        parseFloat(pickupLng),
        MAX_RADIUS_KM
      );

      console.log(`🔍 Booking ${bookingId}: found ${candidates.length} candidate driver(s)`);

      if (!candidates || candidates.length === 0) {
        // No drivers nearby right now — leave booking as pending,
        // just notify the customer so they know
        sendToUser(String(booking.customer_id).trim(), 'no_drivers_nearby', {
          bookingId,
          message: 'No drivers are online nearby right now. Your booking is still active — a driver may accept soon.',
        });
        console.log(`⚠️  No nearby drivers for booking ${bookingId} — left as pending`);
        return;
      }

      // Score and rank drivers
      const ranked = candidates
        .map(d => ({
          ...d,
          score: scoreDriver(d, parseFloat(d.distance_km)),
        }))
        .sort((a, b) => b.score - a.score);

      // Save matching state
      matchingState.set(bookingId, {
        bookingId,
        status:    'searching',
        driverIds: ranked.map(d => String(d.user_id).trim()),
        timer:     null,
      });

      // Broadcast to ALL nearby drivers at once
      let notified = 0;
      const requestPayload = {
        bookingId,
        rideType:           booking.ride_type,
        tripType:           booking.trip_type  || 'one_way',
        tripDuration:       booking.trip_duration ? parseFloat(booking.trip_duration) : null,
        // Customer's car details (for personal driver)
        carModel:           booking.car_model           || null,
        carNumber:          booking.car_number           || null,
        carColor:           booking.car_color            || null,
        specialInstructions:booking.special_instructions || null,
        // Route
        pickupAddress:      booking.pickup_address,
        destinationAddress: booking.destination_address || 'Not specified',
        distanceKm:         parseFloat(booking.distance_km) || 0,
        fareAmount:         parseFloat(booking.fare_amount),
        customerName:       booking.customer_name || 'Customer',
        pickupLat:          parseFloat(booking.pickup_lat),
        pickupLng:          parseFloat(booking.pickup_lng),
        timeoutSeconds:     NOTIFY_TIMEOUT_SECONDS,
      };

      for (const driver of ranked) {
        const uid  = String(driver.user_id).trim();
        const sent = sendToUser(uid, 'new_booking_request', {
          ...requestPayload,
          score: driver.score,
        });
        if (sent) {
          notified++;
          console.log(`📨 Sent to driver ${driver.name} (${uid})`);
        } else {
          console.log(`⚠️  Driver ${driver.name} (${uid}) not connected via socket`);
        }
      }

      console.log(`📡 Booking ${bookingId}: notified ${notified}/${ranked.length} driver(s)`);

      // Fallback: if no targeted sends worked, do a global broadcast
      // Every connected socket will receive it; the driver dashboard
      // filters by role and shows the card only to drivers
      if (notified === 0) {
        const io = getIO();
        if (io) {
          console.log(`📢 Fallback: global broadcast for booking ${bookingId}`);
          io.emit('new_booking_request', { ...requestPayload, isBroadcast: true });
          notified = -1; // Mark as broadcast
        }
      }

      // After NOTIFY_TIMEOUT_SECONDS, re-broadcast to catch drivers who came online
      // But DO NOT cancel the booking — leave it pending
      const state = matchingState.get(bookingId);
      if (state) {
        state.timer = setTimeout(async () => {
          const current = await bookingModel.findById(bookingId);
          if (!current || current.status !== 'pending') {
            matchingState.delete(bookingId);
            return;
          }
          // Still pending — re-broadcast to any newly connected drivers
          console.log(`🔄 Re-broadcasting booking ${bookingId} (still pending after timeout)`);
          matchingService.findAndDispatch(bookingId, pickupLat, pickupLng);
        }, NOTIFY_TIMEOUT_SECONDS * 1000);
      }

    } catch (err) {
      console.error(`Matching error for booking ${bookingId}:`, err.message);
    }
  },

  // Driver accepted — clear timer, notify others
  async handleAccept(bookingId, driverUserId) {
    const state = matchingState.get(bookingId);
    if (state) {
      if (state.timer) clearTimeout(state.timer);
      matchingState.delete(bookingId);

      // Notify all other notified drivers that this ride was taken
      for (const uid of (state.driverIds || [])) {
        if (uid !== String(driverUserId).trim()) {
          sendToUser(uid, 'booking_request_expired', {
            bookingId,
            reason: 'Another driver accepted this ride.',
          });
        }
      }
    }
    return { success: true };
  },

  handleReject(bookingId, driverUserId) {
    // Driver dismissed the card — no action needed
    return { success: true };
  },

  cancelMatching(bookingId) {
    const state = matchingState.get(bookingId);
    if (state) {
      if (state.timer) clearTimeout(state.timer);
      matchingState.delete(bookingId);
    }
  },

  getState(bookingId) {
    return matchingState.get(bookingId) || null;
  },

  // Called when a driver goes online — send them any pending nearby bookings
  async dispatchPendingToDriver(driverUserId, driverLat, driverLng) {
    try {
      // First check: don't dispatch if driver already has an active ride
      const driverProfile = await driverModel.findByUserId(driverUserId);
      if (!driverProfile) return;

      const alreadyBusy = await driverModel.hasActiveRide(driverProfile.id);
      if (alreadyBusy) {
        console.log(`Driver ${driverUserId} already has an active ride — skipping dispatch`);
        return;
      }

      const pendingBookings = await bookingModel.findPendingNearby(
        parseFloat(driverLat),
        parseFloat(driverLng),
        MAX_RADIUS_KM
      );

      if (pendingBookings.length === 0) return;

      console.log(`📨 Sending ${pendingBookings.length} pending booking(s) to driver ${driverUserId}`);

      // Stagger sends by 800ms each so the driver's browser can render
      // each card before the next one arrives — prevents race conditions
      for (let i = 0; i < pendingBookings.length; i++) {
        const booking = pendingBookings[i];
        setTimeout(() => {
          sendToUser(String(driverUserId).trim(), 'new_booking_request', {
            bookingId:          booking.id,
            rideType:           booking.ride_type,
            tripType:           booking.trip_type           || 'one_way',
            tripDuration:       booking.trip_duration        ? parseFloat(booking.trip_duration) : null,
            carModel:           booking.car_model            || null,
            carNumber:          booking.car_number           || null,
            carColor:           booking.car_color            || null,
            specialInstructions:booking.special_instructions || null,
            pickupAddress:      booking.pickup_address,
            destinationAddress: booking.destination_address  || 'Not specified',
            distanceKm:         parseFloat(booking.distance_km) || 0,
            fareAmount:         parseFloat(booking.fare_amount),
            customerName:       booking.customer_name        || 'Customer',
            pickupLat:          parseFloat(booking.pickup_lat),
            pickupLng:          parseFloat(booking.pickup_lng),
            timeoutSeconds:     NOTIFY_TIMEOUT_SECONDS,
          });
        }, i * 800); // 800ms gap between each card
      }

    } catch (err) {
      console.error('dispatchPendingToDriver error:', err.message);
    }
  },
};

module.exports = matchingService;
