import { z } from 'zod';
import { config } from './config';
import { now, sql, tx, type Param } from './db';
import { HttpError } from './http';
import { notify } from './notifications';
import { storeHasStock, watcherIds } from './audience';
import { PLANS, isSellingAt, daysLeftAt } from '../shared/plans';
import type { PlanId } from '../shared/types';
import { formatMoney, normalizeProductName } from '../shared/format';
import type { BuyerOffer, Category, ProductDetail, ProductSummary, StoreProfile, VendorOffer } from '../shared/types';

export interface StoreRef {
  id: number;
  name: string;
  ownerId: number;
}

export interface StockChange {
  offerId: number;
  productId: number;
  productName: string;
  storeId: number;
  storeName: string;
  ownerId: number;
  before: number;
  after: number;
}

export const offerCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  priceCents: z.number().int().min(1).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean().default(true),
});

export const offerPatchSchema = z.object({
  priceCents: z.number().int().min(1).max(100_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const productQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  sort: z.enum(['name', 'price_asc', 'price_desc']).optional(),
});

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function listCategories(): Category[] {
  return sql.all<Category>('SELECT id, name FROM categories ORDER BY name');
}

export function createCategory(name: string): Category {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) throw new HttpError(400, 'err.validation');
  const existing = sql.get<{ id: number; name: string }>('SELECT id, name FROM categories WHERE name = ?', trimmed);
  if (existing) throw new HttpError(409, 'err.offerExists');
  const info = sql.run('INSERT INTO categories (name) VALUES (?)', trimmed);
  return { id: Number(info.lastInsertRowid), name: trimmed };
}

export function deleteCategory(id: number): void {
  const inUse = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', id);
  if (inUse && inUse.n > 0) throw new HttpError(409, 'err.offerInUse');
  sql.run('DELETE FROM categories WHERE id = ?', id);
}

interface SummaryRow {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  category_id: number | null;
  category_name: string | null;
  min_price_cents: number;
  offer_count: number;
  in_stock_offers: number;
}

export function listProducts(filters: z.infer<typeof productQuerySchema>): ProductSummary[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.categoryId) {
    where.push('p.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const order =
    filters.sort === 'price_asc'
      ? 'min_price_cents ASC'
      : filters.sort === 'price_desc'
        ? 'min_price_cents DESC'
        : 'p.name ASC';
  const whereSql = where.map((clause) => `AND ${clause}`).join(' ');
  const rows = sql.all<SummaryRow>(
    `SELECT p.id, p.name, p.description, p.image_url, p.category_id, c.name AS category_name,
       MIN(o.price_cents) AS min_price_cents,
       COUNT(o.id) AS offer_count,
       SUM(CASE WHEN o.stock > 0 THEN 1 ELSE 0 END) AS in_stock_offers
     FROM products p
     JOIN offers o ON o.product_id = p.id AND o.is_active = 1
     JOIN stores s ON s.id = o.store_id
     JOIN users u ON u.id = s.owner_id AND u.status = 'active'
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE 1 = 1 ${whereSql}
     GROUP BY p.id
     ORDER BY ${order}
     LIMIT 200`,
    ...params,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    categoryId: row.category_id,
    categoryName: row.category_name,
    minPriceCents: row.min_price_cents,
    offerCount: row.offer_count,
    inStockOffers: row.in_stock_offers,
  }));
}

interface BuyerOfferRow {
  offer_id: number;
  product_id: number;
  product_name: string;
  image_url: string | null;
  store_id: number;
  store_name: string;
  store_address: string;
  price_cents: number;
  stock: number;
}

const BUYER_OFFER_SQL = `SELECT o.id AS offer_id, o.product_id, p.name AS product_name,
    COALESCE(o.image_url, p.image_url) AS image_url, o.description AS offer_description,
    s.id AS store_id, s.name AS store_name, s.address AS store_address, o.price_cents, o.stock
  FROM offers o
  JOIN products p ON p.id = o.product_id
  JOIN stores s ON s.id = o.store_id AND (s.sells_until IS NULL OR s.sells_until > datetime('now'))
  JOIN users u ON u.id = s.owner_id AND u.status = 'active'
  WHERE (s.sells_until IS NULL OR s.sells_until > datetime('now'))`;

function toBuyerOffer(row: BuyerOfferRow): BuyerOffer {
  return {
    offerId: row.offer_id,
    productId: row.product_id,
    productName: row.product_name,
    imageUrl: row.image_url,
    storeId: row.store_id,
    storeName: row.store_name,
    storeAddress: row.store_address,
    priceCents: row.price_cents,
    stock: row.stock,
  };
}

export function getProductDetail(productId: number, viewerId: number | null): ProductDetail {
  const product = sql.get<{
    id: number;
    name: string;
    description: string | null;
    image_url: string | null;
    category_id: number | null;
    category_name: string | null;
  }>(
    `SELECT p.id, p.name, p.description, p.image_url, p.category_id, c.name AS category_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    productId,
  );
  if (!product) throw new HttpError(404, 'err.productNotFound');
  const offers = sql
    .all<BuyerOfferRow>(`${BUYER_OFFER_SQL} AND o.product_id = ? AND o.is_active = 1 ORDER BY o.price_cents ASC, s.name ASC`, productId)
    .map(toBuyerOffer);
  const watching =
    viewerId !== null && !!sql.get('SELECT 1 AS found FROM watches WHERE user_id = ? AND product_id = ?', viewerId, productId);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: product.image_url,
    categoryId: product.category_id,
    categoryName: product.category_name,
    minPriceCents: offers[0]?.priceCents ?? 0,
    offerCount: offers.length,
    inStockOffers: offers.filter((offer) => offer.stock > 0).length,
    offers,
    watching,
  };
}

interface VendorOfferRow {
  offer_id: number;
  product_id: number;
  product_name: string;
  description: string | null;
  image_url: string | null;
  category_id: number | null;
  category_name: string | null;
  price_cents: number;
  stock: number;
  is_active: number;
  other_sellers: number;
  updated_at: string;
}

const VENDOR_OFFER_SQL = `SELECT o.id AS offer_id, o.product_id, p.name AS product_name,
    COALESCE(o.description, p.description) AS description,
    COALESCE(o.image_url, p.image_url) AS image_url,
    p.category_id, c.name AS category_name, o.price_cents, o.stock, o.is_active, o.updated_at,
    (SELECT COUNT(*) FROM offers x WHERE x.product_id = o.product_id AND x.store_id <> o.store_id AND x.is_active = 1) AS other_sellers
  FROM offers o
  JOIN products p ON p.id = o.product_id
  LEFT JOIN categories c ON c.id = p.category_id`;

function toVendorOffer(row: VendorOfferRow): VendorOffer {
  return {
    offerId: row.offer_id,
    productId: row.product_id,
    productName: row.product_name,
    description: row.description,
    imageUrl: row.image_url,
    categoryId: row.category_id,
    categoryName: row.category_name,
    priceCents: row.price_cents,
    stock: row.stock,
    isActive: row.is_active === 1,
    otherSellers: row.other_sellers,
    updatedAt: row.updated_at,
  };
}

export function listVendorOffers(storeId: number): VendorOffer[] {
  return sql.all<VendorOfferRow>(`${VENDOR_OFFER_SQL} WHERE o.store_id = ? ORDER BY p.name ASC`, storeId).map(toVendorOffer);
}

function getVendorOffer(storeId: number, offerId: number): VendorOffer {
  const row = sql.get<VendorOfferRow>(`${VENDOR_OFFER_SQL} WHERE o.id = ? AND o.store_id = ?`, offerId, storeId);
  if (!row) throw new HttpError(404, 'err.offerNotFound');
  return toVendorOffer(row);
}

export function createOffer(
  store: StoreRef,
  input: z.infer<typeof offerCreateSchema>,
): { offer: VendorOffer; productCreated: boolean } {
  const plan = vendorPlan(store.id);
  if (!plan.selling) throw new HttpError(403, 'err.storePaused');
  if (plan.productLimit !== null && plan.productCount >= plan.productLimit) {
    throw new HttpError(403, 'err.planLimit', { limit: plan.productLimit });
  }
  const normalized = normalizeProductName(input.name);
  const timestamp = now();
  const result = tx(() => {
    const existing = sql.get<{ id: number; name: string }>('SELECT id, name FROM products WHERE normalized_name = ?', normalized);
    let productId: number;
    let productName: string;
    if (existing) {
      productId = existing.id;
      productName = existing.name;
      sql.run(
        `UPDATE products SET description = COALESCE(description, ?), image_url = COALESCE(image_url, ?),
           category_id = COALESCE(category_id, ?), updated_at = ? WHERE id = ?`,
        input.description || null,
        input.imageUrl || null,
        input.categoryId ?? null,
        timestamp,
        productId,
      );
    } else {
      const info = sql.run(
        `INSERT INTO products (name, normalized_name, description, category_id, image_url, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.name,
        normalized,
        input.description || null,
        input.categoryId ?? null,
        input.imageUrl || null,
        store.ownerId,
        timestamp,
        timestamp,
      );
      productId = Number(info.lastInsertRowid);
      productName = input.name;
    }
    if (sql.get('SELECT id FROM offers WHERE product_id = ? AND store_id = ?', productId, store.id)) {
      throw new HttpError(409, 'err.offerExists');
    }
    const info = sql.run(
      `INSERT INTO offers (product_id, store_id, price_cents, stock, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      productId,
      store.id,
      input.priceCents,
      input.stock,
      input.isActive ? 1 : 0,
      timestamp,
      timestamp,
    );
    return { offerId: Number(info.lastInsertRowid), productId, productName, productCreated: !existing };
  });
  if (!result.productCreated && input.isActive && input.stock > 0) {
    notify(watcherIds(result.productId), {
      type: 'product.new_seller',
      titleKey: 'notif.newSeller.title',
      bodyKey: 'notif.newSeller.body',
      params: { product: result.productName, store: store.name, price: formatMoney(input.priceCents, config.currency) },
      data: { productId: result.productId, offerId: result.offerId, storeId: store.id },
    });
  }
  return { offer: getVendorOffer(store.id, result.offerId), productCreated: result.productCreated };
}

export function updateOffer(
  store: StoreRef,
  offerId: number,
  patch: z.infer<typeof offerPatchSchema>,
  lowStockThreshold: number,
): VendorOffer {
  const before = sql.get<{
    product_id: number;
    product_name: string;
    price_cents: number;
    stock: number;
    is_active: number;
  }>(
    `SELECT o.product_id, p.name AS product_name, o.price_cents, o.stock, o.is_active
     FROM offers o JOIN products p ON p.id = o.product_id WHERE o.id = ? AND o.store_id = ?`,
    offerId,
    store.id,
  );
  if (!before) throw new HttpError(404, 'err.offerNotFound');
  const priceCents = patch.priceCents ?? before.price_cents;
  const stock = patch.stock ?? before.stock;
  const isActive = patch.isActive ?? before.is_active === 1;
  const imageUrl = patch.imageUrl === undefined ? undefined : (patch.imageUrl || null);
  const description = patch.description === undefined ? undefined : (patch.description || null);
  sql.run(
    `UPDATE offers SET price_cents = ?, stock = ?, is_active = ?,
       image_url = COALESCE(?, image_url), description = COALESCE(?, description), updated_at = ? WHERE id = ?`,
    priceCents,
    stock,
    isActive ? 1 : 0,
    imageUrl === undefined ? null : imageUrl,
    description === undefined ? null : description,
    now(),
    offerId,
  );
  // If an explicit null was requested, clear the override.
  if (patch.imageUrl === null) sql.run('UPDATE offers SET image_url = NULL, updated_at = ? WHERE id = ?', now(), offerId);
  if (patch.description === null) sql.run('UPDATE offers SET description = NULL, updated_at = ? WHERE id = ?', now(), offerId);
  if (priceCents !== before.price_cents) {
    notify(watcherIds(before.product_id), {
      type: 'product.price_changed',
      titleKey: 'notif.priceChanged.title',
      bodyKey: 'notif.priceChanged.body',
      params: {
        product: before.product_name,
        store: store.name,
        price: formatMoney(priceCents, config.currency),
        oldPrice: formatMoney(before.price_cents, config.currency),
      },
      data: { productId: before.product_id, offerId, storeId: store.id },
    });
  }
  if (stock !== before.stock) {
    emitStockAlerts(
      {
        offerId,
        productId: before.product_id,
        productName: before.product_name,
        storeId: store.id,
        storeName: store.name,
        ownerId: store.ownerId,
        before: before.stock,
        after: stock,
      },
      lowStockThreshold,
    );
  }
  return getVendorOffer(store.id, offerId);
}

// Applies a stock change. Must run inside a transaction so a failed order rolls back cleanly.
export function adjustStock(offerId: number, delta: number): StockChange {
  const row = sql.get<{
    product_id: number;
    product_name: string;
    store_id: number;
    store_name: string;
    owner_id: number;
    stock: number;
  }>(
    `SELECT o.product_id, p.name AS product_name, s.id AS store_id, s.name AS store_name, s.owner_id, o.stock
     FROM offers o
     JOIN products p ON p.id = o.product_id
     JOIN stores s ON s.id = o.store_id
     WHERE o.id = ?`,
    offerId,
  );
  if (!row) throw new HttpError(404, 'err.offerNotFound');
  const after = row.stock + delta;
  if (after < 0) {
    throw new HttpError(409, 'err.onlyLeft', { stock: row.stock, product: row.product_name, store: row.store_name });
  }
  sql.run('UPDATE offers SET stock = ?, updated_at = ? WHERE id = ?', after, now(), offerId);
  return {
    offerId,
    productId: row.product_id,
    productName: row.product_name,
    storeId: row.store_id,
    storeName: row.store_name,
    ownerId: row.owner_id,
    before: row.stock,
    after,
  };
}

// Sends stock notifications after a change is committed.
export function emitStockAlerts(change: StockChange, lowStockThreshold: number): void {
  if (change.before === change.after) return;
  const data = { productId: change.productId, offerId: change.offerId, storeId: change.storeId };
  if (change.before > 0 && change.after === 0) {
    notify([change.ownerId], {
      type: 'product.out_of_stock',
      titleKey: 'notif.outOfStock.title',
      bodyKey: 'notif.outOfStock.body',
      params: { product: change.productName, store: change.storeName },
      data,
    });
    if (!storeHasStock(change.productId, change.storeId)) {
      notify(watcherIds(change.productId), {
        type: 'product.out_of_stock',
        titleKey: 'notif.soldOut.title',
        bodyKey: 'notif.soldOut.body',
        params: { product: change.productName },
        data,
      });
    }
    return;
  }
  if (change.before === 0 && change.after > 0) {
    notify(watcherIds(change.productId), {
      type: 'product.back_in_stock',
      titleKey: 'notif.backInStock.title',
      bodyKey: 'notif.backInStock.body',
      params: { product: change.productName, store: change.storeName, stock: change.after },
      data,
    });
    return;
  }
  if (change.before > lowStockThreshold && change.after <= lowStockThreshold && change.after > 0) {
    notify([change.ownerId], {
      type: 'product.low_stock',
      titleKey: 'notif.lowStock.title',
      bodyKey: 'notif.lowStock.body',
      params: { product: change.productName, store: change.storeName, stock: change.after },
      data,
    });
  }
}

export function setWatch(userId: number, productId: number, watching: boolean): boolean {
  if (!sql.get('SELECT id FROM products WHERE id = ?', productId)) throw new HttpError(404, 'err.productNotFound');
  if (watching) {
    sql.run('INSERT OR IGNORE INTO watches (user_id, product_id, created_at) VALUES (?, ?, ?)', userId, productId, now());
  } else {
    sql.run('DELETE FROM watches WHERE user_id = ? AND product_id = ?', userId, productId);
  }
  return watching;
}
export function deleteOffer(store: StoreRef, offerId: number): void {
  const row = sql.get<{ id: number; order_count: number }>(
    "SELECT o.id, (SELECT COUNT(*) FROM order_items oi JOIN orders ord ON ord.id = oi.order_id WHERE oi.offer_id = o.id AND ord.status IN ('placed','preparing','ready','out_for_delivery')) AS order_count FROM offers o WHERE o.id = ? AND o.store_id = ?",
    offerId,
    store.id,
  );
  if (!row) throw new HttpError(404, 'err.offerNotFound');
  if (row.order_count > 0) throw new HttpError(409, 'err.offerInUse');
  sql.run('DELETE FROM offers WHERE id = ?', offerId);
}

export function vendorPlan(storeId: number): { plan: string; sellsUntil: string | null; daysLeft: number; selling: boolean; productCount: number; productLimit: number | null; transportSharePercent: number; priceCents: number; trialDays: number } {
  const store = sql.get<{ plan: string; sells_until: string | null }>('SELECT plan, sells_until FROM stores WHERE id = ?', storeId);
  const plan = (store?.plan ?? 'trial') as PlanId;
  const sellsUntil = store?.sells_until ?? null;
  const productCount = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM offers WHERE store_id = ?', storeId)?.n ?? 0;
  const details = PLANS[plan] ?? PLANS.trial;
  return {
    plan,
    sellsUntil,
    daysLeft: daysLeftAt(sellsUntil),
    selling: isSellingAt(sellsUntil),
    productCount,
    productLimit: details.productLimit,
    transportSharePercent: details.transportSharePercent,
    priceCents: details.priceCents,
    trialDays: 30,
  };
}

export function isStoreSelling(storeId: number): boolean {
  const row = sql.get<{ sells_until: string | null }>('SELECT sells_until FROM stores WHERE id = ?', storeId);
  return isSellingAt(row?.sells_until ?? null);
}
export function getStoreProfile(storeId: number): StoreProfile {
  const store = sql.get<{ id: number; name: string; description: string | null; address: string; phone: string | null; website: string | null; banner_url: string | null; open_time: string | null; close_time: string | null; lat: number; lng: number }>(
    'SELECT id, name, description, address, phone, website, banner_url, open_time, close_time, lat, lng FROM stores WHERE id = ?',
    storeId,
  );
  if (!store) throw new HttpError(404, 'err.storeNotFound');
  const selling = isStoreSelling(storeId);
  if (!selling) throw new HttpError(404, 'err.storeClosed');
  const offers = sql.all<{ offer_id: number; product_id: number; product_name: string; image_url: string | null; description: string | null; price_cents: number; stock: number; is_active: number }>(
    `SELECT o.id AS offer_id, o.product_id, p.name AS product_name, COALESCE(o.image_url, p.image_url) AS image_url, COALESCE(o.description, p.description) AS description, o.price_cents, o.stock, o.is_active
     FROM offers o JOIN products p ON p.id = o.product_id
     WHERE o.store_id = ? AND o.is_active = 1 AND o.stock > 0 ORDER BY p.name`,
    storeId,
  );
  const productCount = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM offers WHERE store_id = ? AND is_active = 1 AND stock > 0', storeId)?.n ?? 0;
  return {
    id: store.id,
    name: store.name,
    description: store.description,
    address: store.address,
    phone: store.phone,
    bannerUrl: store.banner_url,
    website: store.website,
    openTime: store.open_time,
    closeTime: store.close_time,
    lat: store.lat,
    lng: store.lng,
    productCount,
    offers: offers.map((o) => ({
      offerId: o.offer_id,
      productId: o.product_id,
      productName: o.product_name,
      imageUrl: o.image_url,
      description: o.description,
      priceCents: o.price_cents,
      stock: o.stock,
      isActive: o.is_active === 1,
    })),
  };
}
