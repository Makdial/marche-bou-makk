import { z } from 'zod';
import { config } from './config';
import { sql } from './db';
import type { PublicSettings, Settings } from '../shared/types';

const DEFAULTS: Settings = {
  commissionPercent: 15,
  baseDeliveryFeeCents: 50_000,
  perKmFeeCents: 15_000,
  dispatchRadiusKm: 8,
  lowStockThreshold: 3,
};

export const settingsSchema = z.object({
  commissionPercent: z.number().min(0).max(50).optional(),
  baseDeliveryFeeCents: z.number().int().min(0).max(10_000_000).optional(),
  perKmFeeCents: z.number().int().min(0).max(10_000_000).optional(),
  dispatchRadiusKm: z.number().min(1).max(100).optional(),
  lowStockThreshold: z.number().int().min(0).max(1000).optional(),
});

export function getSettings(): Settings {
  const rows = sql.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
  return { ...DEFAULTS, ...stored };
}

export function updateSettings(patch: z.infer<typeof settingsSchema>): Settings {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sql.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }
  return getSettings();
}

export function getPublicSettings(): PublicSettings {
  const settings = getSettings();
  return {
    currency: config.currency,
    center: config.center,
    baseDeliveryFeeCents: settings.baseDeliveryFeeCents,
    perKmFeeCents: settings.perKmFeeCents,
  };
}
