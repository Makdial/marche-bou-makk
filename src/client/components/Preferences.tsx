import { LOCALE_NAMES, LOCALES, type Locale } from '../../shared/locale';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';

export function Preferences() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <div className="preferences">
      <select aria-label={t('common.language')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn ghost small"
        onClick={toggleTheme}
        aria-label={dark ? t('common.switchToLight') : t('common.switchToDark')}
      >
        {dark ? t('common.lightMode') : t('common.darkMode')}
      </button>
    </div>
  );
}
