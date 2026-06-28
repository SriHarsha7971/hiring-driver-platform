// scripts/socket.js
// Client-side Socket.IO handler.
// Connects to the server, registers the user, and listens for
// real-time events sent by the backend.
//
// Events this script handles:
//   Customer:
//     booking_status_updated  → update status badge on history page
//     no_drivers_found        → show alert that no driver is available
//     booking_cancelled       → show cancellation notice
//
//   Driver:
//     new_booking_request     → show the incoming ride request card
//     booking_request_expired → hide the request card (timeout)

let socket = null;

// ─────────────────────────────────────────────
// Connect and register with the server
// ─────────────────────────────────────────────
function connectSocket() {
  if (typeof io === 'undefined') {
    console.warn('Socket.IO client not loaded.');
    return;
  }

  const user = getUser();
  if (!user) return;

  // Connect to the backend server
  socket = io('http://localhost:3000', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  function registerUser() {
    console.log('🔌 Registering user with socket:', user.id);
    socket.emit('register', user.id);
  }

  socket.on('connect', () => {
    console.log('🔌 Socket connected:', socket.id);
    // Register immediately on every connect/reconnect
    registerUser();
  });

  socket.on('reconnect', () => {
    console.log('🔌 Socket reconnected');
    registerUser();
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 Socket disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('🔌 Socket connection error:', err.message);
  });

  // ── Customer events ──────────────────────────────────────────────────────
  socket.on('booking_status_updated', (data) => {
    console.log('📦 Booking status updated:', data);
    handleBookingStatusUpdate(data);
  });

  socket.on('no_drivers_nearby', (data) => {
    console.log('⚠️ No drivers nearby:', data);
    showToast(
      data.message || 'No drivers nearby. Your booking is still active.',
      'warning',
      6000
    );
  });

  socket.on('no_drivers_found', (data) => {
    console.log('❌ No drivers found:', data);
    handleNoDriversFound(data);
  });

  socket.on('booking_cancelled', (data) => {
    console.log('🚫 Booking cancelled:', data);
    handleBookingCancelled(data);
  });

  // ── Driver events ────────────────────────────────────────────────────────
  socket.on('new_booking_request', (data) => {
    console.log('🆕 New booking request:', data);
    // Only show the request card if this user is a driver
    const currentUser = getUser();
    if (currentUser && currentUser.role === 'driver') {
      handleNewBookingRequest(data);
    }
  });

  socket.on('booking_request_expired', (data) => {
    console.log('⏰ Booking request expired:', data);
    handleRequestExpired(data);
  });

  socket.on('driver_location_update', (data) => {
    // Update the driver marker on the customer's map if it's visible
    handleDriverLocationUpdate(data);
  });

  return socket;
}

// ─────────────────────────────────────────────
// Customer: booking status was updated
// ─────────────────────────────────────────────
function handleBookingStatusUpdate(data) {
  const { bookingId, status, driverName, vehicleNumber, message } = data;

  // Update status badge in the booking card if it's visible
  const card = document.getElementById(`booking-${bookingId}`);
  if (card) {
    const badge = card.querySelector('.badge');
    if (badge) {
      badge.outerHTML = getStatusBadge(status);
    }
  }

  // Show a toast notification
  const statusMessages = {
    accepted:        `🚗 Driver ${driverName || ''} accepted your ride!`,
    driver_arriving: `📍 Your driver is on the way!`,
    ride_started:    `🚀 Your ride has started. Enjoy!`,
    completed:       `✅ Ride completed! Please rate your driver.`,
    cancelled:       `❌ Your ride was cancelled.`,
  };

  const msg = message || statusMessages[status] || `Booking status: ${status}`;
  const type = status === 'cancelled' ? 'error'
    : status === 'completed' ? 'success'
    : 'info';

  showToast(msg, type, 5000);

  // If we're on the history page, refresh the list to show the latest state
  if (typeof loadBookingHistory === 'function') {
    setTimeout(loadBookingHistory, 500);
  }

  // If ride is completed, prompt to rate the driver
  if (status === 'completed') {
    setTimeout(() => {
      if (typeof promptRating === 'function') {
        promptRating(bookingId);
      } else {
        // Default: redirect to rating page
        const doRate = confirm('Your ride is complete! Would you like to rate your driver?');
        if (doRate) {
          window.location.href = `rate-driver.html?bookingId=${bookingId}`;
        }
      }
    }, 1500);
  }
}

// ─────────────────────────────────────────────
// Customer: no drivers found
// ─────────────────────────────────────────────
function handleNoDriversFound(data) {
  showToast(
    data.message || 'No drivers available in your area. Please try again.',
    'error',
    6000
  );

  // Refresh history to show cancelled status
  if (typeof loadBookingHistory === 'function') {
    setTimeout(loadBookingHistory, 1000);
  }
}

// ─────────────────────────────────────────────
// Customer: booking was cancelled by driver
// ─────────────────────────────────────────────
function handleBookingCancelled(data) {
  showToast(
    `Your ride was cancelled by the ${data.cancelledBy}.${data.reason ? ' Reason: ' + data.reason : ''}`,
    'error',
    6000
  );

  if (typeof loadBookingHistory === 'function') {
    setTimeout(loadBookingHistory, 500);
  }
}

// ─────────────────────────────────────────────
// Driver: new ride request received
// Appends a card — never replaces existing ones
// ─────────────────────────────────────────────
function handleNewBookingRequest(data) {
  const requestArea = document.getElementById('ride-request-area');
  if (!requestArea) return;

  // If the area still shows the placeholder, clear it first
  const placeholder = requestArea.querySelector('.request-placeholder, [data-placeholder]');
  if (placeholder || requestArea.children.length === 0 ||
      requestArea.innerHTML.includes('Waiting for ride')) {
    requestArea.innerHTML = '';
  }

  // Don't add duplicate card for the same booking
  if (document.getElementById(`request-card-${data.bookingId}`)) {
    console.log(`Card for booking ${data.bookingId} already shown — skipping`);
    return;
  }

  // Create a wrapper div and append it — never overwrite existing cards
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-bottom:12px;';
  wrapper.id = `wrapper-${data.bookingId}`;
  wrapper.innerHTML = renderRideRequestCard(data);
  requestArea.appendChild(wrapper);

  // Start the countdown for this specific card
  startRequestCountdown(data.bookingId, data.timeoutSeconds || 60);

  // Play notification sound
  playNotificationSound();
}

// ─────────────────────────────────────────────
// Driver: render the incoming request card
// ─────────────────────────────────────────────
function renderRideRequestCard(data) {
  const isPersonal = data.rideType === 'personal_driver';

  // Trip type label
  const tripLabels = { one_way: 'One-way trip', hourly: 'Hourly hire', daily: 'Daily hire' };
  const tripLabel  = tripLabels[data.tripType] || 'One-way trip';
  const durationLabel = data.tripDuration
    ? (data.tripType === 'hourly'
        ? `${data.tripDuration} hr${data.tripDuration !== 1 ? 's' : ''}`
        : `${data.tripDuration} day${data.tripDuration !== 1 ? 's' : ''}`)
    : null;

  return `
    <div id="request-card-${data.bookingId}" style="width:100%;">

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <div style="font-size:18px; font-weight:700; color:var(--gray-900);">New ride request!</div>
          <div style="font-size:13px; color:var(--gray-500);">
            ${isPersonal ? '🚗 Personal driver' : '🛺 Taxi'} · ${tripLabel}
            ${durationLabel ? `· ${durationLabel}` : ''}
          </div>
        </div>
        <div id="countdown-${data.bookingId}" style="
          width:56px; height:56px; border-radius:50%;
          background:conic-gradient(var(--primary) 100%, var(--gray-200) 0%);
          display:flex; align-items:center; justify-content:center;
          font-size:18px; font-weight:700; color:var(--primary);
          border:3px solid var(--gray-200);">
          ${data.timeoutSeconds || 60}
        </div>
      </div>

      <!-- Route -->
      <div style="background:var(--gray-50); border-radius:10px; padding:12px; margin-bottom:10px;">
        <div style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px; font-size:13px; color:var(--gray-700);">
          <span style="color:#059669; flex-shrink:0;">📍</span>
          <span><strong>Pickup:</strong> ${data.pickupAddress}</span>
        </div>
        ${data.destinationAddress && data.destinationAddress !== 'Not specified' ? `
        <div style="display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--gray-700);">
          <span style="color:#dc2626; flex-shrink:0;">🎯</span>
          <span><strong>Drop:</strong> ${data.destinationAddress}</span>
        </div>` : `
        <div style="font-size:12px; color:var(--gray-400); margin-top:4px;">
          📅 ${tripLabel}${durationLabel ? ' for ' + durationLabel : ''} — flexible route
        </div>`}
      </div>

      <!-- Customer's car details (personal driver only) -->
      ${isPersonal && data.carModel ? `
      <div style="background:#eff6ff; border:1px solid #93c5fd; border-radius:10px; padding:10px 12px; margin-bottom:10px;">
        <div style="font-size:12px; font-weight:600; color:#1e40af; margin-bottom:6px;">Customer's vehicle</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:12px; color:#1e40af;">
          <span>🚗 ${data.carModel}</span>
          <span>🔢 ${data.carNumber || '—'}</span>
          ${data.carColor ? `<span>🎨 ${data.carColor}</span>` : ''}
        </div>
        ${data.specialInstructions ? `
        <div style="margin-top:6px; font-size:12px; color:#1e40af; border-top:1px solid #bfdbfe; padding-top:6px;">
          📝 ${data.specialInstructions}
        </div>` : ''}
      </div>` : ''}

      <!-- Fare + distance stats -->
      <div style="display:flex; justify-content:space-between; margin-bottom:14px; gap:8px;">
        <div style="text-align:center; padding:8px 12px; background:var(--gray-50); border-radius:8px; flex:1;">
          <div style="font-size:18px; font-weight:700; color:var(--primary);">₹${data.fareAmount}</div>
          <div style="font-size:11px; color:var(--gray-400);">FARE</div>
        </div>
        ${data.distanceKm > 0 ? `
        <div style="text-align:center; padding:8px 12px; background:var(--gray-50); border-radius:8px; flex:1;">
          <div style="font-size:18px; font-weight:700; color:var(--gray-800);">${data.distanceKm} km</div>
          <div style="font-size:11px; color:var(--gray-400);">DISTANCE</div>
        </div>` : ''}
        <div style="text-align:center; padding:8px 12px; background:var(--gray-50); border-radius:8px; flex:1;">
          <div style="font-size:14px; font-weight:600; color:var(--gray-800);">${data.customerName || 'Customer'}</div>
          <div style="font-size:11px; color:var(--gray-400);">RIDER</div>
        </div>
      </div>

      <!-- Accept / Reject buttons -->
      <div style="display:flex; gap:10px;">
        <button class="btn btn-danger" style="flex:1; padding:13px;"
                onclick="rejectBooking('${data.bookingId}')">
          Reject
        </button>
        <button class="btn btn-success" style="flex:2; padding:13px; font-size:15px;"
                onclick="acceptBooking('${data.bookingId}')">
          Accept ride
        </button>
      </div>

    </div>`;
}

// ─────────────────────────────────────────────
// Driver: countdown timer for request card
// ─────────────────────────────────────────────
let countdownTimers = {};

function startRequestCountdown(bookingId, seconds) {
  let remaining = seconds;

  // Clear any existing timer for this booking
  if (countdownTimers[bookingId]) {
    clearInterval(countdownTimers[bookingId]);
  }

  countdownTimers[bookingId] = setInterval(() => {
    remaining--;
    const el = document.getElementById(`countdown-${bookingId}`);
    if (el) {
      el.textContent = remaining;
      // Turn the conic gradient based on remaining time
      const pct = (remaining / seconds) * 100;
      const color = remaining <= 10 ? '#ef4444' : 'var(--primary)';
      el.style.background = `conic-gradient(${color} ${pct}%, var(--gray-200) 0%)`;
      el.style.color = color;
    }

    if (remaining <= 0) {
      clearInterval(countdownTimers[bookingId]);
      handleRequestExpired({ bookingId });
    }
  }, 1000);
}

// ─────────────────────────────────────────────
// Driver: request expired (timeout or already taken)
// ─────────────────────────────────────────────
function handleRequestExpired(data) {
  // Stop the countdown timer for this booking
  if (countdownTimers[data.bookingId]) {
    clearInterval(countdownTimers[data.bookingId]);
    delete countdownTimers[data.bookingId];
  }

  // Remove this specific card's wrapper
  const wrapper = document.getElementById(`wrapper-${data.bookingId}`);
  if (wrapper) {
    // Brief "expired" animation before removing
    const card = document.getElementById(`request-card-${data.bookingId}`);
    if (card) {
      card.style.opacity = '0.5';
      card.style.transition = 'opacity 0.3s';
    }
    setTimeout(() => {
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);

      // Only show placeholder if NO cards remain in the area
      const requestArea = document.getElementById('ride-request-area');
      if (requestArea && requestArea.children.length === 0) {
        requestArea.innerHTML = `
          <div>
            <div style="font-size:40px; margin-bottom:var(--space-3);">📡</div>
            <p style="font-weight:600; color:var(--gray-600); margin-bottom:var(--space-2);">
              Waiting for ride requests
            </p>
            <p style="font-size:13px; color:var(--gray-400);">
              Go online to start receiving requests
            </p>
          </div>`;
      }
    }, 600);
  }
}

// ─────────────────────────────────────────────
// Driver: accept a booking
// ─────────────────────────────────────────────
async function acceptBooking(bookingId) {
  // Clear the countdown for this booking
  if (countdownTimers[bookingId]) {
    clearInterval(countdownTimers[bookingId]);
    delete countdownTimers[bookingId];
  }

  // Disable buttons to prevent double-click
  const card = document.getElementById(`request-card-${bookingId}`);
  if (card) {
    card.querySelectorAll('button').forEach(btn => { btn.disabled = true; });
  }

  const result = await api.post(`/bookings/${bookingId}/accept`, {});

  if (result.ok && result.data.success) {
    showToast('Booking accepted! Head to the pickup location.', 'success', 4000);

    // Clear ALL countdown timers and ALL pending request cards
    // A driver can only handle one ride at a time
    Object.keys(countdownTimers).forEach(id => {
      clearInterval(countdownTimers[id]);
      delete countdownTimers[id];
    });
    const requestArea = document.getElementById('ride-request-area');
    if (requestArea) {
      requestArea.innerHTML = `
        <div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:12px;
                    padding:20px; text-align:center;">
          <div style="font-size:40px; margin-bottom:10px;">✅</div>
          <p style="font-weight:700; font-size:16px; margin-bottom:6px; color:#166534;">Ride accepted!</p>
          <p style="font-size:13px; color:#166534; margin-bottom:14px;">Head to the pickup location.</p>
          <a href="booking-history.html" class="btn btn-primary btn-sm">View ride details</a>
        </div>`;
    }
  } else {
    showToast(result.data?.message || 'Could not accept. The ride may have been taken.', 'error');
    handleRequestExpired({ bookingId });
  }
}

// ─────────────────────────────────────────────
// Driver: reject a booking
// ─────────────────────────────────────────────
async function rejectBooking(bookingId) {
  if (countdownTimers[bookingId]) {
    clearInterval(countdownTimers[bookingId]);
    delete countdownTimers[bookingId];
  }

  await api.post(`/bookings/${bookingId}/reject`, {});
  showToast('Ride rejected.', 'info');

  // Remove only this card, leave other pending cards intact
  handleRequestExpired({ bookingId });
}

// ─────────────────────────────────────────────
// Play a short notification sound using Web Audio API
// ─────────────────────────────────────────────
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Audio API not available — silently ignore
  }
}

// ─────────────────────────────────────────────
// Customer: driver's live location update
// ─────────────────────────────────────────────
let _driverLiveMarker = null;

function handleDriverLocationUpdate(data) {
  // Only update if we have a Leaflet map with the 'map' variable available
  if (typeof map === 'undefined' || !map) return;

  const { latitude, longitude, driverId } = data;

  if (_driverLiveMarker) {
    // Smoothly move the existing marker
    _driverLiveMarker.setLatLng([latitude, longitude]);
  } else {
    // Create a new live driver marker (blue car icon)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="16" fill="#2563eb" stroke="white" stroke-width="2.5" opacity="0.9"/>
      <text x="18" y="23" text-anchor="middle" font-size="16" fill="white">🚗</text>
    </svg>`;

    const icon = L.divIcon({
      html: svg, iconSize: [36, 36], iconAnchor: [18, 18], className: '',
    });

    _driverLiveMarker = L.marker([latitude, longitude], { icon })
      .addTo(map)
      .bindPopup('Your driver');
  }
}

// Expose socket instance for use in other scripts
function getSocket() { return socket; }
