import { useState, useEffect } from 'react';

export type ThemeId = 'dark' | 'dusk' | 'contrast' | 'topo' | 'day';

const STORAGE_KEY = 'ferry-tracker-theme';

export const THEMES: Array<{
  id: ThemeId;
  label: string;
  swatch: string;
  mapStyleId: string;
  cssTheme: string | null;
}> = [
  { id: 'dark',     label: 'Dark',     swatch: '#060d1a', mapStyleId: 'ocean',        cssTheme: null },
  { id: 'dusk',     label: 'Dusk',     swatch: '#1a0a2e', mapStyleId: 'dataviz-dark', cssTheme: 'dusk' },
  { id: 'contrast', label: 'Contrast', swatch: '#000000', mapStyleId: 'ocean',        cssTheme: 'contrast' },
  { id: 'topo',     label: 'Topo',     swatch: '#2d4a1e', mapStyleId: 'topo-v2',      cssTheme: 'topo' },
  { id: 'day',      label: 'Day',      swatch: '#e8f4fd', mapStyleId: 'streets-v2',   cssTheme: 'day' },
];

export function getMapStyleUrl(themeId: ThemeId, apiKey: string): string {
  const theme = THEMES.find(t => t.id === themeId) ?? THEMES[0];
  return `https://api.maptiler.com/maps/${theme.mapStyleId}/style.json?key=${apiKey}`;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeId) ?? 'dark';
  });

  useEffect(() => {
    const themeObj = THEMES.find(t => t.id === theme) ?? THEMES[0];
    const body = document.body;
    if (themeObj.cssTheme == null) {
      body.removeAttribute('data-theme');
    } else {
      body.setAttribute('data-theme', themeObj.cssTheme);
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}
