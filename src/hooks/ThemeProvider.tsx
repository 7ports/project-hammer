import type { ReactNode } from 'react';
import { ThemeContext, useThemeInit } from './useTheme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, setThemeState } = useThemeInit();

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}
