/**
 * matching.js — AI Match Scoring Engine (Stub)
 *
 * This module provides the client-side stub of the match scoring engine.
 * In production, scoring runs server-side (Node.js / Python ML service).
 * The client calls the REST API and receives scored match objects.
 *
 * Score Dimensions (weights must sum to 1.0):
 *  - routeOverlap     40% — Percentage of rider path covered by driver route
 *  - timingDelta      25% — Closeness of departure times (within ±30 min)
 *  - seatAvailability 15% — Binary: driver has enough seats
 *  - budgetRange      10% — Overlap between rider budget and driver price
 *  - trustScore       10% — Normalized trust score of the driver
 *
 * FUTURE:
 *  - Replace with real API call: POST /api/matches
 *  - Add ML model inference (route embedding similarity)
 *  - Add recurring commute auto-matching via cron
 *  - Cache results per route hash
 *  - Add gender preference filter
 */

(function () {
  'use strict';

  // ── Scoring Weights ───────────────────────────────────────────
  const WEIGHTS = {
    routeOverlap:     0.40,
    timingDelta:      0.25,
    seatAvailability: 0.15,
    budgetRange:      0.10,
    trustScore:       0.10,
  };

  // ── Sub-scorers ───────────────────────────────────────────────

  /**
   * scoreRouteOverlap(overlapKm, riderTotalKm)
   * Returns 0–1 based on what fraction of rider's route is covered.
   * FUTURE: Use Hausdorff distance or polyline intersection on server.
   */
  function scoreRouteOverlap(overlapKm, riderTotalKm) {
    if (riderTotalKm <= 0) return 0;
    return Math.min(1, overlapKm / riderTotalKm);
  }

  /**
   * scoreTimingDelta(riderTimeMin, driverTimeMin)
   * Returns 1.0 if identical, 0 if > 30 min apart.
   * Uses a linear decay over 30 minutes.
   */
  function scoreTimingDelta(riderTimeMin, driverTimeMin) {
    const MAX_DELTA = 30; // minutes
    const delta = Math.abs(riderTimeMin - driverTimeMin);
    return Math.max(0, 1 - delta / MAX_DELTA);
  }

  /**
   * scoreSeatAvailability(seatsAvailable, seatsNeeded)
   * Binary: 1 if driver has enough seats, 0 otherwise.
   */
  function scoreSeatAvailability(seatsAvailable, seatsNeeded) {
    return seatsAvailable >= seatsNeeded ? 1 : 0;
  }

  /**
   * scoreBudgetRange(riderBudget, driverPrice)
   * Returns 1 if rider budget >= driver price.
   * Partial credit if within 20% above budget.
   */
  function scoreBudgetRange(riderBudget, driverPrice) {
    if (riderBudget >= driverPrice) return 1;
    const overage = driverPrice - riderBudget;
    const tolerance = riderBudget * 0.20;
    if (overage <= tolerance) return 1 - (overage / tolerance) * 0.5;
    return 0;
  }

  /**
   * scoreTrustLevel(driverTrust)
   * Normalizes trust score 0–100 to 0–1.
   */
  function scoreTrustLevel(driverTrust) {
    return Math.min(1, Math.max(0, driverTrust / 100));
  }


  // ── Master Scorer ─────────────────────────────────────────────

  /**
   * computeMatchScore(rider, driver) → { score: 0–100, breakdown: {...} }
   *
   * @param {Object} rider  - { timeMins, seatsNeeded, budget, routeKm }
   * @param {Object} driver - { timeMins, seatsAvailable, pricePerSeat, overlapKm, trust }
   * @returns {{ score: number, breakdown: Object }}
   */
  function computeMatchScore(rider, driver) {
    const sub = {
      routeOverlap:     scoreRouteOverlap(driver.overlapKm, rider.routeKm),
      timingDelta:      scoreTimingDelta(rider.timeMins, driver.timeMins),
      seatAvailability: scoreSeatAvailability(driver.seatsAvailable, rider.seatsNeeded),
      budgetRange:      scoreBudgetRange(rider.budget, driver.pricePerSeat),
      trustScore:       scoreTrustLevel(driver.trust),
    };

    const raw = Object.keys(WEIGHTS).reduce((acc, key) => {
      return acc + (sub[key] * WEIGHTS[key]);
    }, 0);

    const score = Math.round(raw * 100);

    return { score, breakdown: sub };
  }


  // ── Batch Rank ────────────────────────────────────────────────

  /**
   * rankMatches(rider, drivers) → sorted array of { driver, score, breakdown }
   * FUTURE: Replace with API call — this runs locally only for demo/testing.
   */
  function rankMatches(rider, drivers) {
    return drivers
      .map(driver => {
        const result = computeMatchScore(rider, driver);
        return { driver, ...result };
      })
      .sort((a, b) => b.score - a.score);
  }


  // ── Sample Data (for demo / testing) ─────────────────────────
  const DEMO_RIDER = {
    timeMins:   540,    // 9:00 AM
    seatsNeeded: 1,
    budget:     150,    // ₹150 max
    routeKm:    10,
  };

  const DEMO_DRIVERS = [
    { id: 1, name: 'Priya Menon',  timeMins: 540, seatsAvailable: 2, pricePerSeat: 110, overlapKm: 8.2, trust: 91 },
    { id: 2, name: 'Dev Kapoor',   timeMins: 555, seatsAvailable: 3, pricePerSeat: 95,  overlapKm: 6.1, trust: 88 },
    { id: 3, name: 'Nidhi Shah',   timeMins: 570, seatsAvailable: 1, pricePerSeat: 130, overlapKm: 5.0, trust: 82 },
  ];

  // Verify scoring on load (visible in console)
  const ranked = rankMatches(DEMO_RIDER, DEMO_DRIVERS);
  console.group('[RidePool] AI Match Scores');
  ranked.forEach(m => {
    console.log(`${m.driver.name}: ${m.score}%`, m.breakdown);
  });
  console.groupEnd();


  // ── Exports ───────────────────────────────────────────────────
  window.RidePoolMatching = {
    computeMatchScore,
    rankMatches,
    WEIGHTS,
    // FUTURE: fetchMatchesFromAPI(rider) → Promise<Match[]>
    // FUTURE: autoMatchRecurring(userId) → WebSocket subscription
  };

}());
