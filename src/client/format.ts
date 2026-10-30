import { numberLocale } from '../shared/format';
import { hasKey } from '../shared/i18n';
import type { TranslationKey } from '../shared/i18n/en';
import type { OrderStatus, PaymentMethod, PaymentStatus, Role, VehicleType } from '../shared/types';
import { getActiveLocale, tr } from './i18n';

export type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

export function statusTone(status: OrderStatus): Tone {
  switch (status) {
    case 'delivered':
      return 'success';
    case 'rejected':
    case 'cancelled':
      return 'danger';
    case 'placed':
      return 'warn';
    default:
      return 'info';
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(numberLocale(getActiveLocale()), { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(value: string): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return tr('time.justNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tr('time.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tr('time.hoursAgo', { count: hours });
  return new Date(value).toLocaleDateString(numberLocale(getActiveLocale()), { dateStyle: 'medium' });
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return '—';
  return `${km.toLocaleString(numberLocale(getActiveLocale()), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

export function roleLabel(role: Role): string {
  return tr(`role.${role}` as TranslationKey);
}

export function statusLabel(status: OrderStatus): string {
  return tr(`status.${status}` as TranslationKey);
}

export function vehicleLabel(vehicle: VehicleType): string {
  return tr(`vehicle.${vehicle}` as TranslationKey);
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return tr(`pay.${method}` as TranslationKey);
}

export function paymentStatusLabel(status: PaymentStatus): string {
  return tr(`paystatus.${status}` as TranslationKey);
}

// Category names come from the catalog. Known names are translated; anything else is shown as typed.
export function categoryLabel(name: string): string {
  const key = `cat.${name}`;
  return hasKey(key) ? tr(key) : name;
}
