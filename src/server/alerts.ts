import { z } from 'zod';
import type { AuthUser } from './auth';
import { now, sql } from './db';
import { HttpError } from './http';
import { notify } from './notifications';
import { openOrderBuyerIds, openOrderConductorIds, vendorIdsForProduct, watcherIds } from './audience';
import type { AlertAudience, AlertItem } from '../shared/types';

export const alertSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1000),
  audience: z.array(z.enum(['vendors', 'buyers', 'conductors'])).min(1),
});

function activeUserIds(role: 'vendor' | 'buyer' | 'conductor'): number[] {
  return sql.all<{ id: number }>("SELECT id FROM users WHERE role = ? AND status = 'active'", role).map((row) => row.id);
}

export function sendAlert(actor: AuthUser, input: z.infer<typeof alertSchema>) {
  const wanted = new Set<AlertAudience>(input.audience);
  const productId = input.productId ?? null;
  let productName: string | null = null;
  let groups: Record<AlertAudience, number[]>;

  if (productId !== null) {
    const product = sql.get<{ name: string }>('SELECT name FROM products WHERE id = ?', productId);
    if (!product) throw new HttpError(404, 'err.productNotFound');
    productName = product.name;
    groups = {
      vendors: wanted.has('vendors') ? vendorIdsForProduct(productId) : [],
      buyers: wanted.has('buyers') ? [...new Set([...watcherIds(productId), ...openOrderBuyerIds(productId)])] : [],
      conductors: wanted.has('conductors') ? openOrderConductorIds(productId) : [],
    };
  } else {
    groups = {
      vendors: wanted.has('vendors') ? activeUserIds('vendor') : [],
      buyers: wanted.has('buyers') ? activeUserIds('buyer') : [],
      conductors: wanted.has('conductors') ? activeUserIds('conductor') : [],
    };
  }

  const everyone = [...new Set([...groups.vendors, ...groups.buyers, ...groups.conductors])];
  const info = sql.run(
    `INSERT INTO alerts (product_id, title, body, audience, recipients, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    productId,
    input.title,
    input.body,
    JSON.stringify(input.audience),
    everyone.length,
    actor.id,
    now(),
  );
  const alertId = Number(info.lastInsertRowid);
  notify(everyone, {
    type: productId !== null ? 'product.alert' : 'announcement',
    title: input.title,
    body: input.body,
    data: { alertId, productId, productName },
  });
  return {
    alertId,
    recipients: {
      vendors: groups.vendors.length,
      buyers: groups.buyers.length,
      conductors: groups.conductors.length,
      total: everyone.length,
    },
  };
}

interface AlertRow {
  id: number;
  product_id: number | null;
  product_name: string | null;
  title: string;
  body: string;
  audience: string;
  recipients: number;
  created_by_name: string | null;
  created_at: string;
}

export function listAlerts(): AlertItem[] {
  return sql
    .all<AlertRow>(
      `SELECT a.id, a.product_id, p.name AS product_name, a.title, a.body, a.audience, a.recipients,
         u.name AS created_by_name, a.created_at
       FROM alerts a
       LEFT JOIN products p ON p.id = a.product_id
       LEFT JOIN users u ON u.id = a.created_by
       ORDER BY a.id DESC
       LIMIT 50`,
    )
    .map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      title: row.title,
      body: row.body,
      audience: JSON.parse(row.audience) as AlertAudience[],
      recipients: row.recipients,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
    }));
}
