import { useState, useEffect } from 'react';
import type { WeatherObservation } from '../types/weather';
import { config } from '../lib/config';

export interface UseWeatherResult {
  weather: WeatherObservation | null;
  loading: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useWeather(): UseWeatherResult {
  const [weather, setWeather] = useState<WeatherObservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async () => {
      try {
        const res = await fetch(`${config.apiUrl}/api/weather`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as WeatherObservation;
        if (!cancelled) {
          setWeather(data);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Weather unavailable');
          setLoading(false);
        }
      }
    };

    void fetchWeather();
    const interval = setInterval(() => void fetchWeather(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { weather, loading, error };
}
