const maptilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY as string ?? '';
const apiUrl = import.meta.env.VITE_API_URL as string ?? 'http://localhost:3001';

if (import.meta.env.PROD && !maptilerApiKey) {
  throw new Error('VITE_MAPTILER_API_KEY is required in production');
}

export const config = {
  maptilerApiKey,
  apiUrl,
} as const;
