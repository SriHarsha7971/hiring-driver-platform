// scripts/driver.js
// Handles all driver-side frontend logic:
//   - Online / offline status toggle
//   - Continuous GPS location sharing (every 15 seconds while online)
//   - Profile display and editing
//   - Earnings display
//
// This script is included on driver-facing pages.
// It depends on api.js being loaded first.

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let isOnline          = false;
let locationInterval  = null;   // Holds the setInterval ID for GPS updates
let driverProfile     = null;   // Cached driver profile from the server

// ─────────────────────────────────────────────
// Load driver profile from API on page load
// ─────────────────────────────────────────────
async function loadDriverProfile() {
  const result = await api.get('/drivers/profile');

  if (result.ok && result.data.success) {
    driverProfile = result.data.driver;
    isOnline = driverProfile.isOnline;
    renderProfile(driverProfile);
    renderStatusUI(isOnline);
    renderStats(driverProfile);
    return driverProfile;
  } else {
    showToast('Failed to load driver profile.', 'error');
    return null;
  }
}

// ─────────────────────────────────────────────
// Render the driver profile card
// ─────────────────────────────────────────────
function renderProfile(driver) {
  // Update any element that displays driver info
  safeSetText('driver-name',           driver.name);
  safeSetText('driver-email',          driver.email);
  safeSetText('driver-phone',          driver.phone || 'Not set');
  safeSetText('driver-vehicle-type',   capitalize(driver.vehicleType));
  safeSetText('driver-vehicle-number', driver.vehicleNumber || 'Not set');
  safeSetText('driver-vehicle-model',  driver.vehicleModel  || 'Not set');
  safeSetText('driver-rating',         `${driver.avgRating} ★`);
  safeSetText('driver-total-rides',    driver.totalRides);
  safeSetText('driver-earnings',       formatCurrency(driver.totalEarnings));
}

// ─────────────────────────────────────────────
// Render online/offline status badge and button
// ─────────────────────────────────────────────
function renderStatusUI(online) {
  // Update status badge
  const badge = document.getElementById('status-badge');
  if (badge) {
    badge.textContent = online ? 'Online' : 'Offline';
    badge.className   = `badge ${online ? 'badge-online' : 'badge-offline'}`;
  }

  // Update toggle button
  const btn = document.getElementById('toggle-status-btn');
  if (btn) {
    btn.textContent   = online ? 'Go Offline' : 'Go Online';
    btn.className     = `btn ${online ? 'btn-danger' : 'btn-success'} btn-full`;
  }

  // Show/hide the GPS sharing indicator
  const gpsIndicator = document.getElementById('gps-indicator');
  if (gpsIndicator) {
    gpsIndicator.style.display = online ? 'flex' : 'none';
  }
}

// ─────────────────────────────────────────────
// Render earnings / stats section
// ─────────────────────────────────────────────
function renderStats(driver) {
  safeSetText('stat-total-rides',    driver.totalRides || 0);
  safeSetText('stat-total-earnings', formatCurrency(driver.totalEarnings || 0));
  safeSetText('stat-avg-rating',     driver.avgRating
    ? `${parseFloat(driver.avgRating).toFixed(1)} ★`
    : 'No ratings yet');
}

// ─────────────────────────────────────────────
// Toggle online / offline status
// ─────────────────────────────────────────────
async function toggleOnlineStatus() {
  const btn = document.getElementById('toggle-status-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
  }

  const newStatus = !isOnline;

  // If going online, start GPS FIRST so location is set before we appear in searches
  if (newStatus) {
    startLocationSharing();
    // Wait for GPS to fire and location to be stored in DB
    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  const result = await api.patch('/drivers/status', { isOnline: newStatus });

  if (result && result.ok && result.data && result.data.success) {
    isOnline = newStatus;
    renderStatusUI(isOnline);
    showToast(result.data.message, 'success');

    if (!isOnline) {
      stopLocationSharing();
    }
    // The server will automatically send any pending bookings
    // via dispatchPendingToDriver when it processes the status update
  } else {
    if (newStatus) stopLocationSharing();
    const msg = result?.data?.message || 'Failed to update status.';
    showToast(msg, 'error');
  }

  if (btn) btn.disabled = false;
}

// ─────────────────────────────────────────────
// GPS Location Sharing
// ─────────────────────────────────────────────

function startLocationSharing() {
  if (!navigator.geolocation) {
    showToast('Your browser does not support GPS location.', 'warning');
    return;
  }

  // Send location immediately
  sendCurrentLocation();

  // Then send every 15 seconds while online
  locationInterval = setInterval(sendCurrentLocation, 15000);
}

function stopLocationSharing() {
  if (locationInterval) {
    clearInterval(locationInterval);
    locationInterval = null;
  }
}

function sendCurrentLocation() {
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude, accuracy } = position.coords;

      const result = await api.patch('/drivers/location', { latitude, longitude });

      if (result && result.ok) {
        safeSetText('gps-coords', `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      }
    },
    (error) => {
      console.warn('GPS error:', error.message);
      // If GPS is denied, use a fallback test location so driver appears in searches
      // Remove this in production
      if (error.code === error.PERMISSION_DENIED) {
        showToast('GPS access denied. Using approximate location.', 'warning');
        // Use a default location (Hyderabad city centre) as fallback
        api.patch('/drivers/location', { latitude: 17.385, longitude: 78.4867 });
        safeSetText('gps-coords', 'approx. location');
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    }
  );
}

// ─────────────────────────────────────────────
// Profile Edit Form
// ─────────────────────────────────────────────

function showEditProfileForm() {
  if (!driverProfile) return;

  // Populate the edit form fields with current values
  safeSetValue('edit-name',           driverProfile.name);
  safeSetValue('edit-phone',          driverProfile.phone || '');
  safeSetValue('edit-vehicle-type',   driverProfile.vehicleType);
  safeSetValue('edit-vehicle-number', driverProfile.vehicleNumber || '');
  safeSetValue('edit-vehicle-model',  driverProfile.vehicleModel  || '');

  const modal = document.getElementById('edit-profile-modal');
  if (modal) modal.style.display = 'flex';
}

function hideEditProfileForm() {
  const modal = document.getElementById('edit-profile-modal');
  if (modal) modal.style.display = 'none';
}

async function submitProfileEdit(event) {
  event.preventDefault();

  const body = {
    name:          safeGetValue('edit-name'),
    phone:         safeGetValue('edit-phone'),
    vehicleType:   safeGetValue('edit-vehicle-type'),
    vehicleNumber: safeGetValue('edit-vehicle-number'),
    vehicleModel:  safeGetValue('edit-vehicle-model'),
  };

  const btn = document.getElementById('save-profile-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }

  const result = await api.patch('/drivers/profile', body);

  if (result.ok && result.data.success) {
    driverProfile = result.data.driver;
    renderProfile(driverProfile);
    hideEditProfileForm();
    showToast('Profile updated successfully!', 'success');
  } else {
    showToast(result.data.message || 'Failed to update profile.', 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
}

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────

function safeSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function safeSetValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function safeGetValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
