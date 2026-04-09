import { THEMES, useTheme } from '../../hooks/useTheme';
import type { ThemeId } from '../../hooks/useTheme';
import './ThemeSwitcher.css';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switcher" role="group" aria-label="Color theme">
      {THEMES.map(t => (
        <button
          key={t.id}
          className={`theme-switcher__btn${theme === t.id ? ' theme-switcher__btn--active' : ''}`}
          type="button"
          aria-label={t.label}
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id as ThemeId)}
          title={t.label}
        >
          <span className="theme-switcher__swatch" style={{ background: t.swatch }} />
          <span className="theme-switcher__label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
