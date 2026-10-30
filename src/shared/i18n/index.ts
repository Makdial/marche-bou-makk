import type { Locale } from '../locale';
import { en, type TranslationKey } from './en';
import { fr } from './fr';
import { wo } from './wo';

export type Params = Record<string, string | number>;

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { en, fr, wo };

export function hasKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

// "one item|many items": the first form is used when {count} is 1.
function pickForm(text: string, count: number): string {
  const forms = text.split('|');
  return forms.length === 1 || count === 1 ? forms[0] : forms[forms.length - 1];
}

// A param value starting with "@" is itself a translation key, e.g. "@status.delivered".
export function translate(locale: Locale, key: TranslationKey, params: Params = {}): string {
  const template = DICTIONARIES[locale][key] ?? en[key];
  const text = typeof params.count === 'number' ? pickForm(template, params.count) : template;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (!(name in params)) return placeholder;
    const value = params[name];
    if (typeof value === 'string' && value.startsWith('@') && hasKey(value.slice(1))) {
      return translate(locale, value.slice(1) as TranslationKey);
    }
    return String(value);
  });
}
