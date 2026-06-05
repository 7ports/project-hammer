import { useWeather } from '../../hooks/useWeather';
import './WeatherStrip.css';

// ---------------------------------------------------------------------------
// Wind direction helpers
// ---------------------------------------------------------------------------

const COMPASS_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Convert bearing in degrees to an 8-point compass arrow character. */
function degToArrow(deg: number): string {
  // Unicode arrows: ↑ ↗ → ↘ ↓ ↙ ← ↖
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return arrows[idx];
}

function degToCompass(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_DIRS[idx];
}

// ---------------------------------------------------------------------------
// Condition → icon mapping
// ---------------------------------------------------------------------------

function conditionIcon(condition: string): string {
  if (!condition) return '\uD83C\uDF24'; // 🌤 default
  const c = condition.toLowerCase();
  if (c.includes('thunder')) return '\u26C8'; // ⛈
  if (c.includes('snow') || c.includes('blizzard') || c.includes('drift')) return '\u2744'; // ❄
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return '\uD83C\uDF2B'; // 🌫
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('freezing')) return '\uD83C\uDF27'; // 🌧
  if (c.includes('dust') || c.includes('sand')) return '\uD83C\uDF2C'; // 🌬
  if (c.includes('partly')) return '\uD83C\uDF24'; // 🌤
  if (c.includes('cloudy') || c.includes('overcast')) return '\u2601'; // ☁
  if (c.includes('clear') || c.includes('sunny')) return '\u2600'; // ☀
  if (c.includes('lightning')) return '\u26A1'; // ⚡
  return '\uD83C\uDF24'; // 🌤 default
}

// ---------------------------------------------------------------------------
// WeatherStrip component
// ---------------------------------------------------------------------------

function formatObservedAt(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatVisibility(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function WeatherStrip() {
  const { weather, loading, error, cacheStatus } = useWeather();

  if (loading) {
    return (
      <div className="weather-strip weather-strip--loading" role="status" aria-live="polite" aria-label="Loading weather data">
        <div className="weather-strip__skeleton weather-strip__skeleton--wide" />
        <div className="weather-strip__skeleton weather-strip__skeleton--narrow" />
      </div>
    );
  }

  if (error || !weather) {
    return (
      <div className="weather-strip weather-strip--error" role="status" aria-live="polite" aria-label="Weather data unavailable">
        <span className="weather-strip__error-text">Weather unavailable</span>
      </div>
    );
  }

  const tempRounded = weather.temperatureCelsius != null && !isNaN(weather.temperatureCelsius)
    ? Math.round(weather.temperatureCelsius)
    : null;
  const feelsRounded = weather.feelsLikeCelsius != null && !isNaN(weather.feelsLikeCelsius)
    ? Math.round(weather.feelsLikeCelsius)
    : null;
  const showFeelsLike =
    tempRounded !== null &&
    feelsRounded !== null &&
    Math.abs(feelsRounded - tempRounded) > 2;

  const windSpeed = weather.windSpeedKmh != null && !isNaN(weather.windSpeedKmh) ? weather.windSpeedKmh : null;
  const windDir = weather.windDirectionDeg != null && !isNaN(weather.windDirectionDeg) ? weather.windDirectionDeg : null;
  const showGust =
    weather.windGustKmh != null && !isNaN(weather.windGustKmh) &&
    windSpeed !== null &&
    weather.windGustKmh > windSpeed + 10;

  const condition = weather.condition ?? 'Unknown';
  const icon = conditionIcon(condition);
  const windArrow = windDir !== null ? degToArrow(windDir) : '';
  const windCompass = windDir !== null ? degToCompass(windDir) : '';

  const visibilityKm = weather.visibilityKm != null && !isNaN(weather.visibilityKm) ? weather.visibilityKm : null;
  const visibilityLow = visibilityKm !== null && visibilityKm < 5;
  const observedAt = weather.observedAt ? formatObservedAt(weather.observedAt) : null;
  const isStale = cacheStatus === 'stale';

  return (
    <div
      className={`weather-strip${isStale ? ' weather-strip--stale' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`Weather at ${weather.stationName ?? 'Billy Bishop'}: ${condition}, ${tempRounded !== null ? `${tempRounded} degrees` : 'temperature unknown'}${observedAt ? `, observed at ${observedAt}` : ''}${isStale ? ' (stale data)' : ''}`}
    >
      {/* Icon + condition */}
      <span className="weather-strip__icon" aria-hidden="true">{icon}</span>
      <span className="weather-strip__condition">{condition}</span>

      {/* Temperature */}
      {tempRounded !== null && (
        <span className="weather-strip__temp">{tempRounded}&deg;</span>
      )}

      {/* Feels like */}
      {showFeelsLike && feelsRounded !== null && (
        <span className="weather-strip__feels-like">Feels {feelsRounded}&deg;</span>
      )}

      {/* Divider */}
      <span className="weather-strip__divider" aria-hidden="true" />

      {/* Wind */}
      {windSpeed !== null && (
        <span className="weather-strip__wind">
          <span className="weather-strip__wind-arrow" aria-hidden="true">{windArrow}</span>
          <span className="weather-strip__wind-label" aria-label={`Wind ${windCompass} ${windSpeed} km/h`}>
            {windSpeed} km/h
          </span>
          {showGust && weather.windGustKmh != null && (
            <span className="weather-strip__gust" aria-label={`Gusts ${weather.windGustKmh} km/h`}>
              gusts {weather.windGustKmh}
            </span>
          )}
        </span>
      )}

      {/* Precipitation warning */}
      {weather.precipitationWarning && (
        <span className="weather-strip__precip-badge" role="status" aria-label="Precipitation expected">
          <span aria-hidden="true">&#x2614;</span> Precipitation expected
        </span>
      )}

      {/* Visibility — emphasised when low (<5 km), the #1 ferry-disruption signal */}
      {visibilityKm !== null && (
        <span
          className={`weather-strip__visibility${visibilityLow ? ' weather-strip__visibility--low' : ''}`}
          aria-label={`Visibility ${formatVisibility(visibilityKm)}${visibilityLow ? ', low' : ''}`}
        >
          <span aria-hidden="true">&#x1F441;</span> Vis {formatVisibility(visibilityKm)}
        </span>
      )}

      {/* Observed-at timestamp + stale-cache hint */}
      {observedAt && (
        <span className="weather-strip__observed-at" title={weather.stationName ?? undefined}>
          {isStale && (
            <span className="weather-strip__stale-badge" role="status" aria-label="Stale cached data">
              stale
            </span>
          )}
          <span className="weather-strip__observed-at-label">as of {observedAt}</span>
        </span>
      )}
    </div>
  );
}
