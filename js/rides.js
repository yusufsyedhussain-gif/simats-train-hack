/**
 * rides.js — Ride State Management
 *
 * Manages the lifecycle of a ride:
 *   DRAFT → POSTED → MATCHED → IN_PROGRESS → COMPLETED | CANCELLED
 *
 * Currently operates on in-memory state (localStorage for persistence).
 * FUTURE:
 *  - Replace with REST API: POST/GET/PATCH /api/rides
 *  - Real-time status via WebSocket events
 *  - Optimistic UI updates with rollback on error
 */

(function () {
  'use strict';

  // ── Ride States ───────────────────────────────────────────────
  const RideStatus = {
    DRAFT:       'DRAFT',
    POSTED:      'POSTED',
    MATCHED:     'MATCHED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED:   'COMPLETED',
    CANCELLED:   'CANCELLED',
  };

  // ── In-Memory Store ───────────────────────────────────────────
  // FUTURE: Replace with IndexedDB or server sync
  let rides = JSON.parse(localStorage.getItem('ridepool_rides') || '[]');

  function persist() {
    localStorage.setItem('ridepool_rides', JSON.stringify(rides));
  }


  // ── CRUD ──────────────────────────────────────────────────────

  /**
   * createRide(data) → ride object
   * Called when driver submits "Post a Ride" form.
   */
  function createRide(data) {
    const ride = {
      id:             'ride_' + Date.now(),
      status:         RideStatus.DRAFT,
      origin:         data.origin,
      destination:    data.destination,
      departureTime:  data.departureTime,    // ISO string
      seatsAvailable: data.seatsAvailable,
      pricePerSeat:   data.pricePerSeat,
      maxDetourKm:    data.maxDetourKm || 2,
      notes:          data.notes || '',
      recurring:      data.recurring || false,
      recurringDays:  data.recurringDays || [],
      driverId:       data.driverId,
      passengers:     [],
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
    };
    rides.push(ride);
    persist();
    console.log('[Rides] Created ride:', ride.id, ride);
    return ride;
  }

  /**
   * postRide(rideId) → ride
   * Transitions ride from DRAFT → POSTED (visible to AI matcher).
   * FUTURE: POST to API, trigger matching job.
   */
  function postRide(rideId) {
    return updateStatus(rideId, RideStatus.POSTED);
  }

  /**
   * requestSeat(rideId, riderId) → { success, ride }
   * Rider requests a seat on a posted ride.
   * FUTURE: POST /api/rides/:id/requests
   */
  function requestSeat(rideId, riderId) {
    const ride = getRide(rideId);
    if (!ride) return { success: false, error: 'Ride not found' };
    if (ride.seatsAvailable <= 0) return { success: false, error: 'No seats available' };
    if (ride.status !== RideStatus.POSTED && ride.status !== RideStatus.MATCHED) {
      return { success: false, error: 'Ride not open for requests' };
    }
    ride.passengers.push({ riderId, status: 'PENDING', requestedAt: new Date().toISOString() });
    ride.updatedAt = new Date().toISOString();
    persist();
    console.log('[Rides] Seat requested by', riderId, 'on ride', rideId);
    return { success: true, ride };
  }

  /**
   * acceptPassenger(rideId, riderId) → { success, ride }
   * Driver accepts a pending seat request.
   * FUTURE: PATCH /api/rides/:id/passengers/:riderId
   */
  function acceptPassenger(rideId, riderId) {
    const ride = getRide(rideId);
    if (!ride) return { success: false, error: 'Ride not found' };
    const passenger = ride.passengers.find(p => p.riderId === riderId);
    if (!passenger) return { success: false, error: 'Passenger request not found' };
    passenger.status = 'ACCEPTED';
    ride.seatsAvailable = Math.max(0, ride.seatsAvailable - 1);
    if (ride.status === RideStatus.POSTED) ride.status = RideStatus.MATCHED;
    ride.updatedAt = new Date().toISOString();
    persist();
    return { success: true, ride };
  }

  /**
   * declinePassenger(rideId, riderId) → { success }
   */
  function declinePassenger(rideId, riderId) {
    const ride = getRide(rideId);
    if (!ride) return { success: false };
    ride.passengers = ride.passengers.filter(p => p.riderId !== riderId);
    ride.updatedAt = new Date().toISOString();
    persist();
    return { success: true };
  }

  /**
   * startRide(rideId) → ride
   * Driver starts the trip: MATCHED → IN_PROGRESS.
   * FUTURE: emit WebSocket event to all passengers.
   */
  function startRide(rideId) {
    const ride = updateStatus(rideId, RideStatus.IN_PROGRESS);
    if (ride) ride.startedAt = new Date().toISOString();
    persist();
    return ride;
  }

  /**
   * completeRide(rideId) → ride
   * Driver marks trip complete: IN_PROGRESS → COMPLETED.
   * FUTURE: trigger payment settlement, prompt for ratings.
   */
  function completeRide(rideId) {
    const ride = updateStatus(rideId, RideStatus.COMPLETED);
    if (ride) ride.completedAt = new Date().toISOString();
    persist();
    return ride;
    // FUTURE: POST /api/rides/:id/complete → settle payment, send rating requests
  }

  /**
   * cancelRide(rideId, reason) → ride
   * Either party cancels: → CANCELLED.
   * FUTURE: Handle refund logic, cancellation penalty.
   */
  function cancelRide(rideId, reason) {
    const ride = updateStatus(rideId, RideStatus.CANCELLED);
    if (ride) { ride.cancellationReason = reason; ride.cancelledAt = new Date().toISOString(); }
    persist();
    return ride;
  }


  // ── Queries ───────────────────────────────────────────────────

  function getRide(rideId) {
    return rides.find(r => r.id === rideId) || null;
  }

  function getRidesForDriver(driverId) {
    return rides.filter(r => r.driverId === driverId);
  }

  function getRidesForRider(riderId) {
    return rides.filter(r => r.passengers.some(p => p.riderId === riderId));
  }

  function getActiveRide(userId) {
    return rides.find(r =>
      (r.driverId === userId || r.passengers.some(p => p.riderId === userId)) &&
      r.status === RideStatus.IN_PROGRESS
    ) || null;
  }


  // ── Helpers ───────────────────────────────────────────────────

  function updateStatus(rideId, newStatus) {
    const ride = getRide(rideId);
    if (!ride) { console.warn('[Rides] Ride not found:', rideId); return null; }
    ride.status = newStatus;
    ride.updatedAt = new Date().toISOString();
    persist();
    console.log('[Rides] Status updated:', rideId, '→', newStatus);
    return ride;
  }

  /**
   * computeDriverPayout(pricePerSeat, seats, commissionRate = 0.12)
   * Returns net earnings after platform commission.
   */
  function computeDriverPayout(pricePerSeat, seats, commissionRate = 0.12) {
    const gross = pricePerSeat * seats;
    const commission = gross * commissionRate;
    return { gross, commission, net: gross - commission };
  }


  // ── Post-Ride Form Handler ─────────────────────────────────────
  const postBtn = document.getElementById('post-ride-btn');
  if (postBtn) {
    postBtn.addEventListener('click', () => {
      const origin  = document.getElementById('driver-origin')?.value?.trim();
      const dest    = document.getElementById('driver-dest')?.value?.trim();
      const date    = document.getElementById('driver-date')?.value;
      const time    = document.getElementById('driver-time')?.value;
      const seats   = parseInt(document.getElementById('seat-count')?.textContent || '1');
      const price   = parseFloat(document.getElementById('price-per-seat')?.value || '0');
      const detour  = parseFloat(document.getElementById('max-detour')?.value || '2');
      const notes   = document.getElementById('ride-notes')?.value || '';
      const recurring = document.getElementById('recurrence-check')?.checked || false;

      if (!origin || !dest || !date || !time || !price) {
        alert('Please fill in all required fields.');
        return;
      }

      const ride = createRide({
        origin, destination: dest,
        departureTime: `${date}T${time}:00`,
        seatsAvailable: seats,
        pricePerSeat: price,
        maxDetourKm: detour,
        notes, recurring,
        driverId: 'user_rohit', // FUTURE: get from auth session
      });

      postRide(ride.id);

      const payout = computeDriverPayout(price, seats);
      postBtn.textContent = '✓ Ride Posted!';
      postBtn.classList.replace('btn-primary', 'btn-success');
      postBtn.disabled = true;

      console.log('[Rides] Ride posted:', ride.id, '| Payout:', payout);
      // FUTURE: redirect to "Requests" tab after posting
      // FUTURE: show success toast notification
    });
  }


  // ── Exports ───────────────────────────────────────────────────
  window.RidePoolRides = {
    RideStatus,
    createRide,
    postRide,
    requestSeat,
    acceptPassenger,
    declinePassenger,
    startRide,
    completeRide,
    cancelRide,
    getRide,
    getRidesForDriver,
    getRidesForRider,
    getActiveRide,
    computeDriverPayout,
    // FUTURE: subscribeToRide(rideId, callback) → WebSocket listener
    // FUTURE: syncWithServer() → fetch pending rides from API
  };

}());
