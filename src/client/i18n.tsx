import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { hasKey, translate, type Params } from '../shared/i18n';
import type { TranslationKey } from '../shared/i18n/en';
import { pickLocale, type Locale } from '../shared/locale';

const STORAGE_KEY = 'mbm.locale';

let activeLocale: Locale = pickLocale(localStorage.getItem(STORAGE_KEY) ?? navigator.language);

export function getActiveLocale(): Locale {
  return activeLocale;
}

// Translates outside components, e.g. in formatting helpers. Uses the language chosen in the app.
export function tr(key: TranslationKey, params?: Params): string {
  return translate(activeLocale, key, params);
}

// Server messages (notifications, order events) carry a translation key; older or admin-written text falls back to its own text.
export function renderMessage(key: string | null | undefined, params: Params | undefined, fallback: string): string {
  return key && hasKey(key) ? tr(key, params) : fallback;
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Params) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(activeLocale);

  const setLocale = useCallback((next: Locale) => {
    activeLocale = next;
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback((key: TranslationKey, params?: Params) => translate(locale, key, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
