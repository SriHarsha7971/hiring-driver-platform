// services/fareService.js
// The core fare calculation engine.
// All pricing logic lives here in one place so it is easy to adjust rates
// without touching controllers or routes.
//
// Fare formula:
//   total = (baseFare + distanceFare) × surchargeMultiplier
//   total = max(total, minimumFare)
//
// Distance is tiered: first N km at rate1, next M km at rate2, rest at rate3.
// This mirrors how most ride-hailing platforms work globally.

// ─────────────────────────────────────────────
// Pricing configuration
// ─────────────────────────────────────────────
const PRICING = {
  taxi: {
    baseFare:    50,
    minimumFare: 80,
    tiers: [
      { upToKm: 5,        ratePerKm: 14 },
      { upToKm: 15,       ratePerKm: 12 },
      { upToKm: Infinity, ratePerKm: 10 },
    ],
  },
  personal_driver: {
    baseFare:    100,
    minimumFare: 150,
    tiers: [
      { upToKm: 5,        ratePerKm: 18 },
      { upToKm: 15,       ratePerKm: 16 },
      { upToKm: Infinity, ratePerKm: 14 },
    ],
    // Additional pricing for personal driver trip types
    hourlyRate: 250,        // ₹250 per hour (minimum 2 hours)
    minimumHours: 2,
    dailyRate: 1800,        // ₹1800 per day (8-hour working day)
    extraHourRate: 200,     // ₹200 per extra hour beyond 8hrs
  },
};

// Surcharges applied on top of the base+distance total
const SURCHARGES = [
  {
    name:       'Peak morning',
    startHour:  8,
    endHour:    10,
    multiplier: 1.20,   // +20%
  },
  {
    name:       'Peak evening',
    startHour:  17,
    endHour:    20,
    multiplier: 1.20,   // +20%
  },
  {
    name:       'Late night',
    startHour:  23,
    endHour:    29,     // 29 = 5am next day (we handle wrap-around below)
    multiplier: 1.15,   // +15%
  },
];

// ─────────────────────────────────────────────
// Helper: calculate the tiered distance fare
// ─────────────────────────────────────────────
function calcDistanceFare(distanceKm, tiers) {
  let remaining = distanceKm;
  let totalFare = 0;
  let prevLimit = 0;
  const breakdown = [];

  for (const tier of tiers) {
    if (remaining <= 0) break;

    // How many km fall in this tier?
    const tierSize  = tier.upToKm === Infinity
      ? remaining
      : Math.min(remaining, tier.upToKm - prevLimit);

    const kmInTier  = Math.min(remaining, tierSize);
    const tierFare  = kmInTier * tier.ratePerKm;

    if (kmInTier > 0) {
      breakdown.push({
        label:     tier.upToKm === Infinity
          ? `Beyond ${prevLimit} km`
          : `First ${tier.upToKm} km`,
        km:        parseFloat(kmInTier.toFixed(2)),
        ratePerKm: tier.ratePerKm,
        subtotal:  parseFloat(tierFare.toFixed(2)),
      });
    }

    totalFare += tierFare;
    remaining -= kmInTier;
    prevLimit  = tier.upToKm;
  }

  return { totalFare, breakdown };
}

// ─────────────────────────────────────────────
// Helper: find the active surcharge for a given hour
// ─────────────────────────────────────────────
function getActiveSurcharge(hour) {
  // Normalise late-night: hours 0–5 are treated as 24–29
  const normalised = hour < 5 ? hour + 24 : hour;

  for (const s of SURCHARGES) {
    if (normalised >= s.startHour && normalised < s.endHour) {
      return s;
    }
  }
  return null; // No surcharge active
}

// ─────────────────────────────────────────────
// Main export: calculate(distanceKm, rideType, bookingDate?)
// ─────────────────────────────────────────────
const fareService = {

  /**
   * Calculate fare and return a full breakdown.
   *
   * @param {number} distanceKm    - Route distance from the map
   * @param {string} rideType      - 'taxi' | 'personal_driver'
   * @param {Date}   bookingDate   - When the ride is (defaults to now)
   * @param {string} tripType      - 'one_way' | 'hourly' | 'daily' (personal driver only)
   * @param {number} tripDuration  - Hours (for hourly) or days (for daily)
   * @returns {object}             - { totalFare, breakdown, surcharge }
   */
  calculate(distanceKm, rideType, bookingDate = new Date(), tripType = 'one_way', tripDuration = null) {
    if (!distanceKm || distanceKm <= 0) {
      // For hourly/daily, distance may not be known upfront — default to 0
      distanceKm = distanceKm || 0;
    }
    if (!PRICING[rideType]) {
      throw new Error(`Unknown ride type: "${rideType}". Must be "taxi" or "personal_driver".`);
    }

    const pricing = PRICING[rideType];
    const km      = parseFloat(distanceKm) || 0;
    const hour    = bookingDate.getHours();

    // ── Personal driver: hourly pricing ─────────────────────────────────────
    if (rideType === 'personal_driver' && tripType === 'hourly') {
      const hours       = Math.max(parseFloat(tripDuration) || pricing.minimumHours, pricing.minimumHours);
      const totalFare   = Math.ceil(hours * pricing.hourlyRate);
      return {
        totalFare,
        currency:       'INR',
        distanceKm:     km,
        rideType,
        tripType:       'hourly',
        tripDuration:   hours,
        baseFare:       0,
        distanceFare:   0,
        surchargeAmount:0,
        surcharge:      null,
        minimumApplied: false,
        breakdown: [
          {
            label:  `Hourly hire (${hours} hour${hours !== 1 ? 's' : ''})`,
            amount: totalFare,
            note:   `₹${pricing.hourlyRate}/hr × ${hours} hrs (min ${pricing.minimumHours} hrs)`,
          },
        ],
        calculatedAt: bookingDate.toISOString(),
        rateCard: {
          hourlyRate:   pricing.hourlyRate,
          minimumHours: pricing.minimumHours,
          tripType:     'hourly',
        },
      };
    }

    // ── Personal driver: daily pricing ───────────────────────────────────────
    if (rideType === 'personal_driver' && tripType === 'daily') {
      const days      = Math.max(parseFloat(tripDuration) || 1, 1);
      const totalFare = Math.ceil(days * pricing.dailyRate);
      return {
        totalFare,
        currency:       'INR',
        distanceKm:     km,
        rideType,
        tripType:       'daily',
        tripDuration:   days,
        baseFare:       0,
        distanceFare:   0,
        surchargeAmount:0,
        surcharge:      null,
        minimumApplied: false,
        breakdown: [
          {
            label:  `Daily hire (${days} day${days !== 1 ? 's' : ''})`,
            amount: totalFare,
            note:   `₹${pricing.dailyRate}/day × ${days} day${days !== 1 ? 's' : ''} (8 hrs/day included)`,
          },
          {
            label:  'Extra hours',
            amount: 0,
            note:   `₹${pricing.extraHourRate}/hr beyond 8 hrs/day — charged after trip`,
          },
        ],
        calculatedAt: bookingDate.toISOString(),
        rateCard: {
          dailyRate:     pricing.dailyRate,
          extraHourRate: pricing.extraHourRate,
          tripType:      'daily',
        },
      };
    }

    // ── One-way (default): distance-based fare ────────────────────────────────
    const baseFare = pricing.baseFare;
    const { totalFare: distanceFare, breakdown: tierBreakdown } = calcDistanceFare(km, pricing.tiers);
    const subtotal = baseFare + distanceFare;
    const activeSurcharge       = getActiveSurcharge(hour);
    const surchargeMultiplier   = activeSurcharge ? activeSurcharge.multiplier : 1.0;
    const surchargeAmount       = activeSurcharge
      ? parseFloat((subtotal * (surchargeMultiplier - 1)).toFixed(2)) : 0;

    let totalBeforeMin = subtotal + surchargeAmount;
    const appliedMinimum = totalBeforeMin < pricing.minimumFare;
    const totalFare      = appliedMinimum
      ? pricing.minimumFare
      : Math.ceil(totalBeforeMin);

    const breakdown = [
      { label: 'Base fare', amount: baseFare, note: 'Flat pickup charge' },
      ...tierBreakdown.map(t => ({
        label:  `Distance — ${t.label}`,
        amount: t.subtotal,
        note:   `${t.km} km × ₹${t.ratePerKm}/km`,
      })),
    ];

    if (activeSurcharge) {
      breakdown.push({
        label:  `${activeSurcharge.name} surcharge`,
        amount: surchargeAmount,
        note:   `${Math.round((surchargeMultiplier - 1) * 100)}% applied`,
      });
    }

    if (appliedMinimum) {
      breakdown.push({
        label:  'Minimum fare applied',
        amount: pricing.minimumFare - totalBeforeMin,
        note:   `Minimum is ₹${pricing.minimumFare}`,
      });
    }

    return {
      totalFare,
      currency:      'INR',
      distanceKm:    km,
      rideType,
      tripType:      'one_way',
      tripDuration:  null,
      baseFare,
      distanceFare:   parseFloat(distanceFare.toFixed(2)),
      surchargeAmount,
      surcharge:      activeSurcharge ? {
        name:       activeSurcharge.name,
        percentage: Math.round((surchargeMultiplier - 1) * 100),
      } : null,
      minimumApplied: appliedMinimum,
      breakdown,
      calculatedAt:   bookingDate.toISOString(),
      rateCard: {
        baseFare:    pricing.baseFare,
        minimumFare: pricing.minimumFare,
        tiers:       pricing.tiers,
        tripType:    'one_way',
      },
    };
  },

  // Expose pricing for use in other parts of the system (e.g. fare display)
  getPricing() {
    return PRICING;
  },

  getSurcharges() {
    return SURCHARGES;
  },
};

module.exports = fareService;
