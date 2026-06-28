// scripts/booking.js
// Handles all booking-related frontend logic:
//   - confirmBooking()   → POST /api/bookings
//   - loadBookingHistory()→ GET  /api/bookings/my
//   - renderBookingCard() → draws a ride card in the history page
//   - cancelBooking()    → POST /api/bookings/:id/cancel
//   - updateStatus()     → PATCH /api/bookings/:id/status  (driver)

// ─────────────────────────────────────────────
// Confirm and create a booking
// Called from book-ride.html after fare is shown
// ─────────────────────────────────────────────
async function confirmBooking(bookingData) {
  const btn = document.getElementById('confirm-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Finding drivers...';
  }

  const result = await api.post('/bookings', bookingData);

  if (result && result.ok && result.data && result.data.success) {
    const booking = result.data.booking;

    sessionStorage.setItem('activeBookingId', booking.id);
    sessionStorage.removeItem('pendingBooking');

    showToast(
      `Booking confirmed! Fare: ${formatCurrency(booking.fareAmount)}. Looking for drivers…`,
      'success',
      4000
    );

    setTimeout(() => {
      window.location.href = 'booking-history.html';
    }, 2000);

  } else {
    const msg = result?.data?.message || 'Booking failed. Please try again.';
    showToast(msg, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirm booking';
    }
  }
}

// ─────────────────────────────────────────────
// Load booking history for the current user
// ─────────────────────────────────────────────
async function loadBookingHistory(statusFilter = null) {
  const listEl = document.getElementById('bookings-list');
  if (!listEl) return;

  listEl.innerHTML = `
    <div class="loading-overlay">
      <span class="spinner"></span>
      <span class="text-muted">Loading rides...</span>
    </div>`;

  const endpoint = statusFilter
    ? `/bookings/my?status=${statusFilter}`
    : '/bookings/my';

  const result = await api.get(endpoint);

  if (!result.ok || !result.data.success) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p>Failed to load bookings. Make sure the server is running.</p>
      </div>`;
    return;
  }

  const bookings = result.data.bookings;

  if (!bookings || bookings.length === 0) {
    const user = getUser();
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p style="font-weight:600; margin-bottom: var(--space-2)">No rides yet</p>
        <p style="font-size: var(--font-size-sm); color: var(--gray-400);">
          ${statusFilter ? `No ${statusFilter} rides found.` : 'Your ride history will appear here.'}
        </p>
        ${user && user.role === 'customer' ? `
          <a href="book-ride.html" class="btn btn-primary" style="margin-top: var(--space-4)">
            Book your first ride
          </a>` : ''}
      </div>`;
    return;
  }

  listEl.innerHTML = bookings.map(b => renderBookingCard(b)).join('');
}

// ─────────────────────────────────────────────
// Render a single booking card HTML
// ─────────────────────────────────────────────
function renderBookingCard(booking) {
  const user       = getUser();
  const isCustomer = user && user.role === 'customer';
  const isDriver   = user && user.role === 'driver';

  const statusBadge = getStatusBadge(booking.status);
  const isPersonal  = booking.rideType === 'personal_driver';

  // Trip type label
  const tripLabels = { one_way: 'One-way', hourly: 'Hourly hire', daily: 'Daily hire' };
  const tripLabel  = tripLabels[booking.tripType] || 'One-way';
  let durationStr  = '';
  if (booking.tripType === 'hourly' && booking.tripDuration) {
    durationStr = ` · ${booking.tripDuration} hr${booking.tripDuration !== 1 ? 's' : ''}`;
  } else if (booking.tripType === 'daily' && booking.tripDuration) {
    durationStr = ` · ${booking.tripDuration} day${booking.tripDuration !== 1 ? 's' : ''}`;
  }
  const rideTypeLabel = isPersonal
    ? `🚗 Personal driver · ${tripLabel}${durationStr}`
    : '🛺 Taxi';

  // Destination display — hourly/daily may not have one
  const destDisplay = booking.destinationAddress ||
    (booking.tripType === 'hourly' ? '📅 Flexible route (hourly)' :
     booking.tripType === 'daily'  ? '📅 Flexible route (daily)'  : '—');

  // Person info
  let personInfo = '';
  if (isCustomer && booking.driverName) {
    personInfo = `
      <div class="booking-person-info">
        <span>🚗 Driver: <strong>${booking.driverName}</strong></span>
        ${booking.vehicleNumber ? `<span> · ${booking.vehicleNumber}</span>` : ''}
        ${booking.driverAvgRating ? `<span> · ⭐ ${booking.driverAvgRating}</span>` : ''}
      </div>`;
  } else if (isDriver && booking.customerName) {
    personInfo = `
      <div class="booking-person-info">
        <span>👤 Customer: <strong>${booking.customerName}</strong></span>
      </div>`;
  }

  // Car details block — shown for personal driver bookings
  let carDetails = '';
  if (isPersonal && (booking.carModel || booking.carNumber)) {
    carDetails = `
      <div style="margin:8px 0 4px; background:#eff6ff; border:1px solid #bfdbfe;
                  border-radius:8px; padding:8px 12px; font-size:12px; color:#1e40af;">
        <div style="font-weight:600; margin-bottom:5px;">🚗 Customer's vehicle</div>
        <div style="display:flex; flex-wrap:wrap; gap:12px;">
          ${booking.carModel  ? `<span>Model: <strong>${booking.carModel}</strong></span>`  : ''}
          ${booking.carNumber ? `<span>Reg: <strong>${booking.carNumber}</strong></span>`    : ''}
          ${booking.carColor  ? `<span>Colour: <strong>${booking.carColor}</strong></span>` : ''}
        </div>
        ${booking.specialInstructions ? `
          <div style="margin-top:5px; padding-top:5px; border-top:1px solid #bfdbfe;">
            📝 <em>${booking.specialInstructions}</em>
          </div>` : ''}
      </div>`;
  }

  // Action buttons
  let actions = '';
  if (isCustomer && ['pending','accepted','driver_arriving','ride_started'].includes(booking.status)) {
    actions = `
      <a href="ride-tracking.html?id=${booking.id}" class="btn btn-primary btn-sm">Track ride</a>
      <button class="btn btn-danger btn-sm" onclick="promptCancel('${booking.id}')">Cancel</button>`;
  }
  if (isDriver && booking.status === 'accepted') {
    actions = `<button class="btn btn-primary btn-sm"
        onclick="updateBookingStatus('${booking.id}', 'driver_arriving')">
      I'm on my way
    </button>`;
  }
  if (isDriver && booking.status === 'driver_arriving') {
    actions = `<button class="btn btn-success btn-sm"
        onclick="updateBookingStatus('${booking.id}', 'ride_started')">
      Start ride
    </button>`;
  }
  if (isDriver && booking.status === 'ride_started') {
    actions = `<button class="btn btn-success btn-sm"
        onclick="updateBookingStatus('${booking.id}', 'completed')">
      Complete ride
    </button>`;
  }
  if (isCustomer && booking.status === 'completed') {
    actions = `
      <a href="rate-driver.html?bookingId=${booking.id}" class="btn btn-outline btn-sm">⭐ Rate driver</a>
      <a href="book-ride.html" class="btn btn-primary btn-sm">Book again</a>`;
  }

  return `
    <div class="booking-card" id="booking-${booking.id}">
      <div class="booking-card-header">
        <div>
          <span style="font-size:var(--font-size-sm); color:var(--gray-500);">${rideTypeLabel}</span>
          <div style="font-size:var(--font-size-xs); color:var(--gray-400); margin-top:2px;">
            ${formatDateTime(booking.createdAt)}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:var(--space-2);">
          ${statusBadge}
          <strong style="color:var(--primary);">${formatCurrency(booking.fareAmount)}</strong>
        </div>
      </div>

      <div class="booking-route">
        <div class="route-point">
          <span class="route-icon" style="color:#059669;">📍</span>
          <span>${booking.pickupAddress}</span>
        </div>
        <div class="route-point" style="margin-top:4px;">
          <span class="route-icon" style="color:#dc2626;">🎯</span>
          <span>${destDisplay}</span>
        </div>
      </div>

      ${carDetails}
      ${personInfo}

      <div class="booking-meta">
        ${booking.distanceKm > 0 ? `<span>📏 ${booking.distanceKm} km</span>` : ''}
        ${booking.cancelledBy ? `<span>❌ Cancelled by ${booking.cancelledBy}</span>` : ''}
      </div>

      ${actions ? `<div class="booking-actions">${actions}</div>` : ''}
    </div>`;
}

// Driver: update booking status
// ─────────────────────────────────────────────
async function updateBookingStatus(bookingId, newStatus) {
  const result = await api.patch(`/bookings/${bookingId}/status`, { status: newStatus });

  if (result.ok && result.data.success) {
    const labels = {
      driver_arriving: 'Customer notified you are on the way!',
      ride_started:    'Ride started. Safe travels!',
      completed:       'Ride completed. Great job!',
    };
    showToast(labels[newStatus] || 'Status updated.', 'success');
    loadBookingHistory(); // Refresh list
  } else {
    showToast(result.data?.message || 'Status update failed.', 'error');
  }
}
