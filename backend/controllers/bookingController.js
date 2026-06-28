// controllers/bookingController.js
// Handles all booking lifecycle logic:
//   create    → customer confirms ride → booking row created → status: pending
//   getMyBookings → return bookings for the logged-in user (customer or driver)
//   getById   → single booking detail
//   updateStatus → driver moves booking through states
//   cancel    → customer or driver cancels

const bookingModel        = require('../models/bookingModel');
const driverModel         = require('../models/driverModel');
const fareService         = require('../services/fareService');
const matchingService     = require('../services/matchingService');
const notificationService = require('../services/notificationService');
const rideStatusService   = require('../services/rideStatusService');
const { sendToUser }      = require('../config/socket');

// Valid status transitions enforced by rideStatusService
// (kept here only for reference — logic is in rideStatusService.js)

const bookingController = {

  // ── POST /api/bookings ────────────────────────────────────────────────────
  // Customer creates a booking after seeing the fare estimate.
  // Body: { rideType, pickupAddress, destinationAddress,
  //         pickupLat, pickupLng, destinationLat, destinationLng,
  //         distanceKm, fareAmount }
  async create(req, res, next) {
    try {
      const {
        rideType,
        tripType, tripDuration,
        carModel, carNumber, carColor, specialInstructions,
        pickupAddress, destinationAddress,
        pickupLat, pickupLng,
        destinationLat, destinationLng,
        distanceKm, fareAmount,
      } = req.body;

      // ── Validation ──────────────────────────────────────────────────────
      if (!rideType || !pickupAddress || pickupLat === undefined || pickupLng === undefined) {
        return res.status(400).json({
          success: false,
          message: 'rideType, pickupAddress, pickupLat, and pickupLng are required.',
        });
      }

      if (!['taxi', 'personal_driver'].includes(rideType)) {
        return res.status(400).json({
          success: false,
          message: 'rideType must be "taxi" or "personal_driver".',
        });
      }

      // For personal driver, car details are required
      if (rideType === 'personal_driver') {
        if (!carModel || !carNumber) {
          return res.status(400).json({
            success: false,
            message: 'Car model and car number are required for personal driver bookings.',
          });
        }
      }

      const resolvedTripType = tripType || 'one_way';
      if (!['one_way', 'hourly', 'daily'].includes(resolvedTripType)) {
        return res.status(400).json({
          success: false,
          message: 'tripType must be "one_way", "hourly", or "daily".',
        });
      }

      const km = parseFloat(distanceKm) || 0;

      // Re-calculate fare server-side (never trust client fareAmount)
      const fareResult = fareService.calculate(
        km,
        rideType,
        new Date(),
        resolvedTripType,
        tripDuration ? parseFloat(tripDuration) : null
      );

      // Create the booking row with all fields
      const booking = await bookingModel.create({
        customerId:         req.user.id,
        rideType,
        tripType:           resolvedTripType,
        tripDuration:       tripDuration ? parseFloat(tripDuration) : null,
        carModel:           carModel           || null,
        carNumber:          carNumber          || null,
        carColor:           carColor           || null,
        specialInstructions:specialInstructions || null,
        pickupAddress,
        destinationAddress: destinationAddress || null,
        pickupLat:          parseFloat(pickupLat),
        pickupLng:          parseFloat(pickupLng),
        destinationLat:     destinationLat ? parseFloat(destinationLat) : null,
        destinationLng:     destinationLng ? parseFloat(destinationLng) : null,
        distanceKm:         km,
        fareAmount:         fareResult.totalFare,
      });

      // ── Trigger the matching engine ────────────────────────────────────
      // This runs asynchronously — it finds the best driver, notifies them,
      // handles timeouts, and tries the next driver if needed.
      // We don't await it so the API response returns immediately.
      matchingService.findAndDispatch(
        booking.id,
        parseFloat(pickupLat),
        parseFloat(pickupLng)
      ).catch(err => console.error('Matching error:', err.message));

      return res.status(201).json({
        success: true,
        message: 'Booking created. Searching for the best driver nearby…',
        booking: {
          id:                 booking.id,
          status:             booking.status,
          rideType:           booking.ride_type,
          pickupAddress:      booking.pickup_address,
          destinationAddress: booking.destination_address,
          distanceKm:         parseFloat(booking.distance_km),
          fareAmount:         parseFloat(booking.fare_amount),
          createdAt:          booking.created_at,
        },
        fare: fareResult,
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/bookings/my ──────────────────────────────────────────────────
  // Returns all bookings for the logged-in user.
  // Customers see their bookings as the passenger.
  // Drivers see bookings they have been assigned to.
  // Query param: ?status=pending|accepted|completed|cancelled
  async getMyBookings(req, res, next) {
    try {
      const { status } = req.query;
      let bookings;

      if (req.user.role === 'customer') {
        bookings = await bookingModel.findByCustomer(req.user.id, status || null);
      } else {
        // For drivers, look up their driver profile ID first
        const driverProfile = await driverModel.findByUserId(req.user.id);
        if (!driverProfile) {
          return res.status(404).json({ success: false, message: 'Driver profile not found.' });
        }
        bookings = await bookingModel.findByDriver(driverProfile.id, status || null);
      }

      return res.status(200).json({
        success: true,
        count:   bookings.length,
        bookings: bookings.map(formatBooking),
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/bookings/:id ─────────────────────────────────────────────────
  async getById(req, res, next) {
    try {
      const booking = await bookingModel.findById(req.params.id);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      // Only the customer or the assigned driver can view a booking
      const driverProfile = req.user.role === 'driver'
        ? await driverModel.findByUserId(req.user.id)
        : null;

      const isCustomer = booking.customer_id === req.user.id;
      const isDriver   = driverProfile && booking.driver_id === driverProfile.id;

      if (!isCustomer && !isDriver) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }

      const hasRating = await bookingModel.hasRating(booking.id);

      return res.status(200).json({
        success:   true,
        booking:   formatBooking(booking),
        hasRating,
      });

    } catch (error) {
      next(error);
    }
  },

  // ── PATCH /api/bookings/:id/status ────────────────────────────────────────
  // Driver updates the booking status through the lifecycle.
  // Body: { status }
  async updateStatus(req, res, next) {
    try {
      const { id }     = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ success: false, message: 'status is required.' });
      }

      const booking = await bookingModel.findById(id);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      // Use rideStatusService to validate the transition
      const check = rideStatusService.canTransition(booking.status, status, req.user.role);
      if (!check.valid) {
        return res.status(400).json({ success: false, message: check.reason });
      }

      // Verify driver owns this booking
      const driverProfile = await driverModel.findByUserId(req.user.id);
      if (!driverProfile) {
        return res.status(403).json({ success: false, message: 'Driver profile not found.' });
      }
      if (booking.driver_id !== driverProfile.id) {
        return res.status(403).json({ success: false, message: 'Not your booking.' });
      }

      // Apply the status update
      const updatedBooking = await bookingModel.updateStatus(id, status);
      if (!updatedBooking) {
        return res.status(400).json({ success: false, message: 'Status update failed.' });
      }

      // Log the transition to history
      await rideStatusService.logTransition({
        bookingId:  id,
        fromStatus: booking.status,
        toStatus:   status,
        changedBy:  req.user.id,
        actorRole:  'driver',
        note:       null,
      });

      // Update driver earnings on completion + restore availability
      if (status === 'completed') {
        await driverModel.incrementStats(driverProfile.id, parseFloat(booking.fare_amount));
        await driverModel.setAvailability(req.user.id, true);
      }

      // Get status metadata for the response
      const statusMeta = rideStatusService.getStatusMeta(status);

      // Notify the customer
      sendToUser(booking.customer_id, 'booking_status_updated', {
        bookingId:     id,
        status,
        statusLabel:   statusMeta.label,
        driverName:    driverProfile.name,
        driverPhone:   driverProfile.phone,
        vehicleType:   driverProfile.vehicle_type,
        vehicleNumber: driverProfile.vehicle_number,
      });

      // Persist notification
      if (status === 'driver_arriving') {
        notificationService.driverArriving(booking, driverProfile);
      } else if (status === 'ride_started') {
        notificationService.rideStarted(booking);
      } else if (status === 'completed') {
        notificationService.rideCompleted(booking);
      }

      return res.status(200).json({
        success:    true,
        message:    `Status updated to "${status}".`,
        booking:    formatBooking(updatedBooking),
        statusMeta,
      });

    } catch (error) {
      next(error);
    }
  },

  // ── POST /api/bookings/:id/accept ─────────────────────────────────────────
  // Driver accepts a ride request.
  async accept(req, res, next) {
    try {
      const { id } = req.params;

      const driverProfile = await driverModel.findByUserId(req.user.id);
      if (!driverProfile) {
        return res.status(404).json({ success: false, message: 'Driver profile not found.' });
      }

      // Verify the booking exists and is still pending
      const existingBooking = await bookingModel.findById(id);
      if (!existingBooking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }
      if (existingBooking.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Booking is already ${existingBooking.status}. Cannot accept.`,
        });
      }

      // ── Guard: driver must not already have an active ride ──────────────
      const alreadyBusy = await driverModel.hasActiveRide(driverProfile.id);
      if (alreadyBusy) {
        return res.status(400).json({
          success: false,
          message: 'You already have an active ride. Complete or cancel it before accepting a new one.',
        });
      }

      // Inform matching service (clears timeout timer if running)
      try {
        await matchingService.handleAccept(id, req.user.id);
      } catch (e) {
        // Matching state may have already resolved — that's fine
      }

      // Update the booking status to accepted and assign this driver
      const booking = await bookingModel.updateStatus(id, 'accepted', driverProfile.id);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      // Mark driver as unavailable — no new requests until this ride ends
      await driverModel.setAvailability(req.user.id, false);

      // Log the transition
      await rideStatusService.logTransition({
        bookingId:  id,
        fromStatus: 'pending',
        toStatus:   'accepted',
        changedBy:  req.user.id,
        actorRole:  'driver',
        note:       `Accepted by ${driverProfile.name}`,
      });

      // Notify the customer their driver is confirmed
      sendToUser(booking.customer_id, 'booking_status_updated', {
        bookingId:     id,
        status:        'accepted',
        driverName:    driverProfile.name,
        driverPhone:   driverProfile.phone,
        vehicleType:   driverProfile.vehicle_type,
        vehicleNumber: driverProfile.vehicle_number,
        vehicleModel:  driverProfile.vehicle_model,
        driverLat:     parseFloat(driverProfile.latitude),
        driverLng:     parseFloat(driverProfile.longitude),
        message:       `${driverProfile.name} has accepted your ride!`,
      });

      // Persist notification
      notificationService.bookingAccepted(booking, driverProfile);

      return res.status(200).json({
        success: true,
        message: 'Booking accepted! Head to the pickup location.',
        booking: formatBooking(booking),
      });

    } catch (error) {
      next(error);
    }
  },

  // ── POST /api/bookings/:id/reject ─────────────────────────────────────────
  // Driver rejects a ride request — triggers dispatch to next driver.
  async reject(req, res, next) {
    try {
      const { id } = req.params;

      const matchResult = await matchingService.handleReject(id, req.user.id);
      if (!matchResult.success) {
        return res.status(400).json({ success: false, message: matchResult.message });
      }

      return res.status(200).json({
        success: true,
        message: 'Booking rejected. Looking for another driver.',
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/bookings/:id/match-status ────────────────────────────────────
  // Customer polls this to know if a driver has been found.
  async matchStatus(req, res, next) {
    try {
      const { id } = req.params;

      const booking = await bookingModel.findById(id);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      const matchState = matchingService.getState(id);

      return res.status(200).json({
        success:        true,
        bookingStatus:  booking.status,
        isSearching:    matchState !== null && matchState.status === 'searching',
        driverAssigned: booking.status === 'accepted' && !!booking.driver_id,
        driverName:     booking.driver_name || null,
        vehicleNumber:  booking.vehicle_number || null,
      });

    } catch (error) {
      next(error);
    }
  },

  // ── Cancel also cleans up matching state ──────────────────────────────────
  // Either customer or driver can cancel.
  // Body: { reason? }
  async cancel(req, res, next) {
    try {
      const { id }     = req.params;
      const { reason } = req.body;

      const booking = await bookingModel.findById(id);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      // Only cancellable if not already completed or cancelled
      if (['completed', 'cancelled'].includes(booking.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel a booking with status "${booking.status}".`,
        });
      }

      // Determine who is cancelling
      let cancelledBy;
      if (req.user.role === 'customer' && booking.customer_id === req.user.id) {
        cancelledBy = 'customer';
      } else if (req.user.role === 'driver') {
        const driverProfile = await driverModel.findByUserId(req.user.id);
        if (driverProfile && booking.driver_id === driverProfile.id) {
          cancelledBy = 'driver';
        }
      }

      if (!cancelledBy) {
        return res.status(403).json({ success: false, message: 'Not authorised to cancel this booking.' });
      }

      const cancelled = await bookingModel.cancel(id, cancelledBy, reason || null);
      if (!cancelled) {
        return res.status(400).json({ success: false, message: 'Cancellation failed.' });
      }

      // Log the cancellation transition
      await rideStatusService.logTransition({
        bookingId:  id,
        fromStatus: booking.status,
        toStatus:   'cancelled',
        changedBy:  req.user.id,
        actorRole:  cancelledBy,
        note:       reason || null,
      });

      // Clean up any active matching process for this booking
      matchingService.cancelMatching(id);

      // If the driver cancelled, make them available again
      if (cancelledBy === 'driver') {
        await driverModel.setAvailability(req.user.id, true);
      }
      // If customer cancelled while driver was assigned, also free the driver
      if (cancelledBy === 'customer' && booking.driver_id) {
        const assignedDriver = await driverModel.findById(booking.driver_id);
        if (assignedDriver) {
          await driverModel.setAvailability(assignedDriver.user_id, true);
        }
      }

      // Notify both parties
      notificationService.bookingCancelled(cancelled, cancelledBy, reason || null);

      // Notify the other party
      const notifyUserId = cancelledBy === 'customer'
        ? (booking.driver_id ? booking.driver_user_id : null)
        : booking.customer_id;

      if (notifyUserId) {
        sendToUser(notifyUserId, 'booking_cancelled', {
          bookingId:   id,
          cancelledBy,
          reason:      reason || null,
        });
      }

      return res.status(200).json({
        success:     true,
        message:     'Booking cancelled.',
        booking:     formatBooking(cancelled),
        cancelledBy,
      });

    } catch (error) {
      next(error);
    }
  },
  // ── GET /api/bookings/:id/status-history ─────────────────────────────────
  // Returns the full ordered log of status transitions for a booking.
  async statusHistory(req, res, next) {
    try {
      const booking = await bookingModel.findById(req.params.id);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      // Access check — customer or assigned driver only
      const isCustomer = booking.customer_id === req.user.id;
      const driverProfile = req.user.role === 'driver'
        ? await driverModel.findByUserId(req.user.id)
        : null;
      const isDriver = driverProfile && booking.driver_id === driverProfile.id;

      if (!isCustomer && !isDriver) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }

      const history = await rideStatusService.getHistory(req.params.id);

      return res.status(200).json({
        success:       true,
        bookingId:     req.params.id,
        currentStatus: booking.status,
        history,
      });

    } catch (error) {
      next(error);
    }
  },

  // ── GET /api/bookings/:id/eta ─────────────────────────────────────────────
  // Returns the driver's estimated time of arrival at the pickup point.
  // Only meaningful when status is 'accepted' or 'driver_arriving'.
  async getETA(req, res, next) {
    try {
      const booking = await bookingModel.findById(req.params.id);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      if (!['accepted', 'driver_arriving'].includes(booking.status)) {
        return res.status(200).json({
          success:    true,
          etaMinutes: null,
          etaText:    'ETA not available for current status',
          status:     booking.status,
        });
      }

      if (!booking.driver_id) {
        return res.status(200).json({
          success:    true,
          etaMinutes: null,
          etaText:    'No driver assigned yet',
        });
      }

      // Get the driver's current location
      const driverProfile = await driverModel.findById(booking.driver_id);
      if (!driverProfile || !driverProfile.latitude || !driverProfile.longitude) {
        return res.status(200).json({
          success:    true,
          etaMinutes: null,
          etaText:    'Driver location unavailable',
        });
      }

      const eta = rideStatusService.calculateETA(
        parseFloat(driverProfile.latitude),
        parseFloat(driverProfile.longitude),
        parseFloat(booking.pickup_lat),
        parseFloat(booking.pickup_lng)
      );

      return res.status(200).json({
        success:    true,
        etaMinutes: eta.etaMinutes,
        etaText:    eta.etaText,
        distanceKm: eta.distanceKm,
        driverLocation: {
          lat: parseFloat(driverProfile.latitude),
          lng: parseFloat(driverProfile.longitude),
        },
      });

    } catch (error) {
      next(error);
    }
  },

};
function formatBooking(b) {
  return {
    id:                 b.id,
    status:             b.status,
    rideType:           b.ride_type,
    tripType:           b.trip_type           || 'one_way',
    tripDuration:       b.trip_duration        ? parseFloat(b.trip_duration) : null,
    carModel:           b.car_model            || null,
    carNumber:          b.car_number           || null,
    carColor:           b.car_color            || null,
    specialInstructions:b.special_instructions || null,
    pickupAddress:      b.pickup_address,
    destinationAddress: b.destination_address  || null,
    pickupLat:          parseFloat(b.pickup_lat),
    pickupLng:          parseFloat(b.pickup_lng),
    destinationLat:     b.destination_lat ? parseFloat(b.destination_lat) : null,
    destinationLng:     b.destination_lng ? parseFloat(b.destination_lng) : null,
    distanceKm:         parseFloat(b.distance_km) || 0,
    fareAmount:         parseFloat(b.fare_amount),
    customerName:       b.customer_name   || null,
    customerPhone:      b.customer_phone  || null,
    driverUserId:       b.driver_user_id  || null,
    driverName:         b.driver_name     || null,
    driverPhone:        b.driver_phone    || null,
    vehicleType:        b.vehicle_type    || null,
    vehicleNumber:      b.vehicle_number  || null,
    vehicleModel:       b.vehicle_model   || null,
    driverAvgRating:    b.driver_avg_rating ? parseFloat(b.driver_avg_rating) : null,
    cancelledBy:        b.cancelled_by    || null,
    cancelReason:       b.cancel_reason   || null,
    createdAt:          b.created_at,
    acceptedAt:         b.accepted_at     || null,
    startedAt:          b.started_at      || null,
    completedAt:        b.completed_at    || null,
  };
}

module.exports = bookingController;
