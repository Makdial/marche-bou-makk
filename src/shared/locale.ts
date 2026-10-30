export const LOCALES = ['en', 'fr', 'wo'] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  wo: 'Wolof',
};

export function pickLocale(value: unknown): Locale {
  const code = typeof value === 'string' ? value.slice(0, 2).toLowerCase() : '';
  return (LOCALES as readonly string[]).includes(code) ? (code as Locale) : 'en';
}
