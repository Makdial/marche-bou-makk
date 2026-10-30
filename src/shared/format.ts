import type { Locale } from './locale';

// Money is stored as whole integers in minor units (amount x 100).
// XOF (West African CFA franc, used in Senegal) is shown in whole francs.
const WHOLE_CURRENCIES = new Set(['XOF']);

export function currencyLabel(currency: string): string {
  return currency === 'XOF' ? 'FCFA' : currency;
}

export function numberLocale(locale: Locale): string {
  return locale === 'en' ? 'en-US' : 'fr-SN';
}

export function formatMoney(cents: number, currency: string, locale: Locale = 'en'): string {
  if (WHOLE_CURRENCIES.has(currency)) {
    const francs = new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 0 }).format(Math.round(cents / 100));
    return `${francs} ${currencyLabel(currency)}`;
  }
  return new Intl.NumberFormat(numberLocale(locale), { style: 'currency', currency }).format(cents / 100);
}

export function moneyInput(cents: number, currency: string): string {
  return WHOLE_CURRENCIES.has(currency) ? String(Math.round(cents / 100)) : (cents / 100).toFixed(2);
}

export function moneyStep(currency: string): string {
  return WHOLE_CURRENCIES.has(currency) ? '1' : '0.01';
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function normalizeProductName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
