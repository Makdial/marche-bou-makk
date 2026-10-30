import { sql, sqlIn } from './db';
import { DELIVERY_STATUSES, OPEN_STATUSES } from '../shared/status';

const idsOf = (rows: { id: number }[]) => rows.map((row) => row.id);

// Every active vendor that currently lists the product.
export function vendorIdsForProduct(productId: number): number[] {
  return idsOf(
    sql.all<{ id: number }>(
      `SELECT DISTINCT u.id FROM offers o
       JOIN stores s ON s.id = o.store_id
       JOIN users u ON u.id = s.owner_id
       WHERE o.product_id = ? AND o.is_active = 1 AND u.status = 'active'`,
      productId,
    ),
  );
}

// Buyers who asked to be told about this product.
export function watcherIds(productId: number): number[] {
  return idsOf(sql.all<{ id: number }>('SELECT user_id AS id FROM watches WHERE product_id = ?', productId));
}

// Buyers with an order in progress that contains this product.
export function openOrderBuyerIds(productId: number): number[] {
  return idsOf(
    sql.all<{ id: number }>(
      `SELECT DISTINCT o.buyer_id AS id FROM orders o
       JOIN order_items i ON i.order_id = o.id
       WHERE i.product_id = ? AND o.status IN (${sqlIn(OPEN_STATUSES)})`,
      productId,
    ),
  );
}

// Conductors currently delivering an order that contains this product.
export function openOrderConductorIds(productId: number): number[] {
  return idsOf(
    sql.all<{ id: number }>(
      `SELECT DISTINCT o.conductor_id AS id FROM orders o
       JOIN order_items i ON i.order_id = o.id
       WHERE i.product_id = ? AND o.conductor_id IS NOT NULL AND o.status IN (${sqlIn(DELIVERY_STATUSES)})`,
      productId,
    ),
  );
}

// True when another active store still has the product in stock.
export function storeHasStock(productId: number, excludeStoreId: number): boolean {
  return !!sql.get(
    `SELECT 1 AS found FROM offers o
     JOIN stores s ON s.id = o.store_id
     JOIN users u ON u.id = s.owner_id
     WHERE o.product_id = ? AND o.store_id <> ? AND o.is_active = 1 AND o.stock > 0 AND u.status = 'active'
     LIMIT 1`,
    productId,
    excludeStoreId,
  );
}
