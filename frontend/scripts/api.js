// scripts/api.js
// A centralized helper for making API calls from the frontend.
// All fetch requests go through these functions so we have one
// place to handle tokens, errors, and base URLs.

const API_BASE_URL = 'http://localhost:3000/api';

// ─────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

function saveAuth(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function isLoggedIn() {
  return !!getToken();
}

// ─────────────────────────────────────────────
// Core Fetch Wrapper
// ─────────────────────────────────────────────

async function apiRequest(method, endpoint, body = null, requiresAuth = true) {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Add auth token if user is logged in and route requires it
  if (requiresAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const options = {
    method: method.toUpperCase(),
    headers,
  };

  if (body && method.toUpperCase() !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    const data = await response.json();

    // If token expired or invalid, redirect to login
    if (response.status === 401) {
      clearAuth();
      // Use relative path so it works regardless of how the frontend is served
      const base = window.location.pathname.includes('/pages/') ? '' : 'pages/';
      window.location.href = base + 'login.html';
      return;
    }

    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.error('API request failed:', error);
    return {
      ok: false,
      status: 0,
      data: { success: false, message: 'Network error. Please check your connection.' },
    };
  }
}

// ─────────────────────────────────────────────
// Convenience Methods
// ─────────────────────────────────────────────

const api = {
  get:    (endpoint, auth = true)         => apiRequest('GET', endpoint, null, auth),
  post:   (endpoint, body, auth = true)   => apiRequest('POST', endpoint, body, auth),
  put:    (endpoint, body, auth = true)   => apiRequest('PUT', endpoint, body, auth),
  patch:  (endpoint, body, auth = true)   => apiRequest('PATCH', endpoint, body, auth),
  delete: (endpoint, auth = true)         => apiRequest('DELETE', endpoint, null, auth),
};

// ─────────────────────────────────────────────
// Role-based Redirect Guard
// Call this at the top of protected pages
// ─────────────────────────────────────────────

function requireAuth(requiredRole = null) {
  if (!isLoggedIn()) {
    const base = window.location.pathname.includes('/pages/') ? '' : 'pages/';
    window.location.href = base + 'login.html';
    return false;
  }
  if (requiredRole) {
    const user = getUser();
    if (user && user.role !== requiredRole) {
      const redirect = user.role === 'driver'
        ? 'driver-dashboard.html'
        : 'customer-dashboard.html';
      window.location.href = redirect;
      return false;
    }
  }
  return true;
}

// Show a toast notification
function showToast(message, type = 'info', duration = 3500) {
  const existing = document.getElementById('toast-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'toast-container';
  container.style.cssText = `
    position: fixed; bottom: 24px; right: 24px;
    z-index: 9999; display: flex; flex-direction: column; gap: 8px;
  `;

  const toast = document.createElement('div');
  const colors = {
    success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6'
  };
  toast.style.cssText = `
    background: ${colors[type] || colors.info}; color: white;
    padding: 12px 20px; border-radius: 8px; font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 320px;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;

  container.appendChild(toast);
  document.body.appendChild(container);

  setTimeout(() => container.remove(), duration);
}

// Format currency (Indian Rupees)
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(amount);
}

// Format date/time nicely
function formatDateTime(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Get status badge HTML
function getStatusBadge(status) {
  const map = {
    pending:        { class: 'badge-pending',   label: 'Pending' },
    accepted:       { class: 'badge-accepted',  label: 'Accepted' },
    driver_arriving:{ class: 'badge-arriving',  label: 'Driver Arriving' },
    ride_started:   { class: 'badge-started',   label: 'Ride Started' },
    completed:      { class: 'badge-completed', label: 'Completed' },
    cancelled:      { class: 'badge-cancelled', label: 'Cancelled' },
  };
  const s = map[status] || { class: '', label: status };
  return `<span class="badge ${s.class}">${s.label}</span>`;
}
