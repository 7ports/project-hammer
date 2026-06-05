/**
 * Trip inference public API.
 *
 * See ./service.ts for the DB-backed scheduler and ./inferTrips.ts for the
 * pure detection function used by tests and the service alike.
 */

export {
  inferTripsFromPositions,
  TRIP_INFERENCE_CONFIG,
  type InferenceInputPosition,
  type InferredTrip,
} from './inferTrips';

export {
  TripInferenceService,
  DEFAULT_TRIP_INFERENCE_INTERVAL_MS,
  type PersistedTrip,
  type TripCompletedListener,
  type TripInferenceServiceOptions,
} from './service';
