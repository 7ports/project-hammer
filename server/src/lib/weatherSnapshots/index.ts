/**
 * Weather snapshot public API.
 *
 * See ./snapshotter.ts for the WeatherSnapshotter class and ./fetcher.ts for
 * the live GeoMet fetcher used in production.
 */

export {
  WeatherSnapshotter,
  DEFAULT_WEATHER_POLL_INTERVAL_MS,
  type WeatherSnapshotterOptions,
} from './snapshotter';

export { liveFetchObservation, type FetchObservation } from './fetcher';
