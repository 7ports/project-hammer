import { useState, useEffect } from 'react';

export type ThemeId = 'dark' | 'dusk' | 'contrast';

const STORAGE_KEY = 'ferry-tracker-theme';

export const THEMES: Array<{ id: ThemeId; label: string; swatch: string }> = [
  { id: 'dark',     label: 'Maritime Dark', swatch: '#060d1a' },
  { id: 'dusk',     label: 'Nautical Dusk', swatch: '#0d0a1a' },
  { id: 'contrast', label: 'High Contrast', swatch: '#000000' },
];

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeId) ?? 'dark';
  });

  useEffect(() => {
    const body = document.body;
    if (theme === 'dark') {
      body.removeAttribute('data-theme');
    } else {
      body.setAttribute('data-theme', theme);
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}
