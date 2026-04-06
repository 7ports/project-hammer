export interface WeatherObservation {
  stationName: string;
  observedAt: string; // ISO 8601 UTC
  temperatureCelsius: number | null;
  feelsLikeCelsius: number | null; // wind chill or humidex if computable, otherwise temperatureCelsius
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  relativeHumidityPct: number | null;
  visibilityKm: number | null;
  pressureKpa: number | null;
  presentWeatherCode: string | null; // raw WMO code from API
  condition: string; // human-readable
  precipitationWarning: boolean;
}
