// services/notificationService.js
// The central notification hub.
// Every meaningful event in the system flows through here:
//   1. Persisted to the notifications table (user can review later)
//   2. Pushed in real-time via Socket.IO to the connected browser
//
// Usage example:
//   await notificationService.bookingAccepted(booking, driverProfile);
//   await notificationService.rideCompleted(booking);

const notificationModel = require('../models/notificationModel');
const { sendToUser }    = require('../config/socket');

// ─────────────────────────────────────────────
// Core dispatch: save + push
// ─────────────────────────────────────────────
async function dispatch(userId, type, title, message, data = {}) {
  try {
    // 1. Persist to database
    const notification = await notificationModel.create({
      userId, type, title, message, data,
    });

    // 2. Push via Socket.IO (fires even if user isn't connected right now —
    //    they'll see it next time they load the notification panel)
    sendToUser(userId, 'notification', {
      id:        notification.id,
      type,
      title,
      message,
      data,
      isRead:    false,
      createdAt: notification.created_at,
    });

    return notification;
  } catch (err) {
    // Never let notification failures crash the main flow
    console.error('Notification dispatch error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Booking lifecycle notifications
// ─────────────────────────────────────────────
const notificationService = {

  // ── New booking created → notify customer ───────────────────────────────
  async bookingCreated(booking, driverCount) {
    return dispatch(
      booking.customer_id,
      'booking_created',
      'Ride booked!',
      `Searching for drivers near you. ${driverCount} driver${driverCount !== 1 ? 's' : ''} nearby.`,
      { bookingId: booking.id, driverCount }
    );
  },

  // ── Driver accepted → notify customer ───────────────────────────────────
  async bookingAccepted(booking, driverProfile) {
    return dispatch(
      booking.customer_id,
      'booking_accepted',
      'Driver found!',
      `${driverProfile.name} is on the way. Vehicle: ${driverProfile.vehicle_model || driverProfile.vehicle_type} (${driverProfile.vehicle_number || 'no plate'}).`,
      {
        bookingId:     booking.id,
        driverName:    driverProfile.name,
        driverPhone:   driverProfile.phone,
        vehicleType:   driverProfile.vehicle_type,
        vehicleNumber: driverProfile.vehicle_number,
        vehicleModel:  driverProfile.vehicle_model,
      }
    );
  },

  // ── Driver arriving → notify customer ───────────────────────────────────
  async driverArriving(booking, driverProfile) {
    return dispatch(
      booking.customer_id,
      'driver_arriving',
      'Driver is arriving!',
      `${driverProfile.name} is almost at your pickup location. Please be ready.`,
      { bookingId: booking.id }
    );
  },

  // ── Ride started → notify customer ──────────────────────────────────────
  async rideStarted(booking) {
    return dispatch(
      booking.customer_id,
      'ride_started',
      'Ride started!',
      `Your ride is underway. Estimated fare: ₹${booking.fare_amount}.`,
      { bookingId: booking.id, fareAmount: booking.fare_amount }
    );
  },

  // ── Ride completed → notify customer ────────────────────────────────────
  async rideCompleted(booking) {
    return dispatch(
      booking.customer_id,
      'ride_completed',
      'Ride completed!',
      `You arrived safely. Total fare: ₹${booking.fare_amount}. Please rate your driver.`,
      {
        bookingId:  booking.id,
        fareAmount: booking.fare_amount,
        driverId:   booking.driver_id,
      }
    );
  },

  // ── Booking cancelled → notify both parties ──────────────────────────────
  async bookingCancelled(booking, cancelledBy, reason) {
    const cancellerName = cancelledBy === 'customer' ? 'the customer' : 'your driver';

    // Notify customer
    if (cancelledBy !== 'customer') {
      await dispatch(
        booking.customer_id,
        'booking_cancelled',
        'Ride cancelled',
        `Your ride was cancelled by ${cancellerName}.${reason ? ' Reason: ' + reason : ''}`,
        { bookingId: booking.id, cancelledBy, reason }
      );
    }

    // Notify driver (if one was assigned)
    if (booking.driver_id && cancelledBy !== 'driver') {
      // Need the driver's user_id — look it up via the booking's joined data
      if (booking.driver_user_id) {
        await dispatch(
          booking.driver_user_id,
          'booking_cancelled',
          'Ride cancelled',
          `The customer cancelled the ride.${reason ? ' Reason: ' + reason : ''}`,
          { bookingId: booking.id, cancelledBy, reason }
        );
      }
    }
  },

  // ── No drivers found → notify customer ──────────────────────────────────
  async noDriversFound(booking) {
    return dispatch(
      booking.customer_id,
      'no_drivers_found',
      'No drivers available',
      'We could not find a driver in your area right now. Please try again in a few minutes.',
      { bookingId: booking.id }
    );
  },

  // ── New ride request → notify driver ────────────────────────────────────
  async newRideRequest(driverUserId, booking) {
    return dispatch(
      driverUserId,
      'new_ride_request',
      'New ride request!',
      `Pickup: ${booking.pickup_address}. Fare: ₹${booking.fare_amount}.`,
      {
        bookingId:          booking.id,
        pickupAddress:      booking.pickup_address,
        destinationAddress: booking.destination_address,
        fareAmount:         booking.fare_amount,
        distanceKm:         booking.distance_km,
      }
    );
  },

  // ── Driver rated → notify driver ─────────────────────────────────────────
  async driverRated(driverUserId, rating, comment, customerName) {
    return dispatch(
      driverUserId,
      'new_rating',
      `New ${rating}★ rating!`,
      `${customerName} rated you ${rating} star${rating !== 1 ? 's' : ''}.${comment ? ' "' + comment + '"' : ''}`,
      { rating, comment, customerName }
    );
  },

  // ── Location update broadcast ────────────────────────────────────────────
  // Sends driver's live GPS to the customer without persisting (ephemeral)
  broadcastDriverLocation(customerUserId, driverInfo) {
    sendToUser(customerUserId, 'driver_location_update', {
      driverId:  driverInfo.driverId,
      latitude:  driverInfo.latitude,
      longitude: driverInfo.longitude,
      bookingId: driverInfo.bookingId,
    });
  },
};

module.exports = notificationService;
