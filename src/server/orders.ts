import crypto from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from './auth';
import { config } from './config';
import { adjustStock, emitStockAlerts, type StockChange } from './catalog';
import {
  conductorsNear,
  getConductorProfile,
  hasActiveDelivery,
  idleOnlineConductors,
  type IdleConductor,
} from './conductors';
import { now, placeholders, sql, sqlIn, tx, type Param } from './db';
import { HttpError } from './http';
import { notify } from './notifications';
import { getSettings } from './settings';
import { distanceKm, estimateMinutes, roundKm, travelMinutes } from '../shared/geo';
import { firstName, formatMoney } from '../shared/format';
import { storeTransportCents } from '../shared/plans';
import type { PlanId } from '../shared/types';
import { translate, type Params } from '../shared/i18n';
import type { TranslationKey } from '../shared/i18n/en';
import { JOB_STATUSES, OPEN_STATUSES } from '../shared/status';
import type {
  OrderEvent,
  OrderItem,
  OrderStatus,
  OrderView,
  PaymentStatus,
  Point,
  Quote,
  QuoteGroup,
  QuoteLine,
  Settings,
  VehicleType,
} from '../shared/types';

export const cartLinesSchema = z
  .array(z.object({ offerId: z.number().int().positive(), quantity: z.number().int().min(1).max(50) }))
  .min(1)
  .max(100);

export const deliverySchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(30),
  address: z.string().trim().min(5).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().trim().max(300).optional(),
});

export const checkoutSchema = z.object({
  items: cartLinesSchema,
  paymentMethod: z.enum(['mobile_money', 'cash']),
  delivery: deliverySchema,
});

export const quoteSchema = z.object({
  items: cartLinesSchema,
  delivery: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
});

type CartLine = z.infer<typeof cartLinesSchema>[number];

interface OfferSnapshot {
  offer_id: number;
  product_id: number;
  product_name: string;
  price_cents: number;
  stock: number;
  is_active: number;
  store_id: number;
  store_name: string;
  store_lat: number;
  store_lng: number;
  owner_id: number;
  owner_status: string;
}

const OFFER_SNAPSHOT_SQL = `SELECT o.id AS offer_id, o.product_id, p.name AS product_name, o.price_cents, o.stock, o.is_active,
    s.id AS store_id, s.name AS store_name, s.lat AS store_lat, s.lng AS store_lng, s.owner_id, u.status AS owner_status
  FROM offers o
  JOIN products p ON p.id = o.product_id
  JOIN stores s ON s.id = o.store_id
  JOIN users u ON u.id = s.owner_id`;

interface PricedLine {
  offer: OfferSnapshot;
  quantity: number;
}

interface PricedGroup {
  storeId: number;
  storeName: string;
  ownerId: number;
  lines: PricedLine[];
  subtotalCents: number;
  distanceKm: number | null;
  deliveryFeeCents: number;
  storeTransportCents: number;
  commissionCents: number;
  totalCents: number;
  etaMinutes: number | null;
}

function resolveLines(items: CartLine[]): PricedLine[] {
  const wanted = new Map<number, number>();
  for (const item of items) wanted.set(item.offerId, (wanted.get(item.offerId) ?? 0) + item.quantity);
  const ids = [...wanted.keys()];
  const rows = sql.all<OfferSnapshot>(`${OFFER_SNAPSHOT_SQL} WHERE o.id IN (${placeholders(ids.length)})`, ...ids);
  const byId = new Map(rows.map((row) => [row.offer_id, row] as const));
  return ids.map((offerId) => {
    const offer = byId.get(offerId);
    const quantity = wanted.get(offerId) ?? 0;
    if (!offer || offer.is_active !== 1 || offer.owner_status !== 'active') {
      throw new HttpError(409, 'err.itemUnavailable');
    }
    if (offer.stock < quantity) {
      throw new HttpError(409, 'err.onlyLeft', {
        stock: offer.stock,
        product: offer.product_name,
        store: offer.store_name,
      });
    }
    return { offer, quantity };
  });
}

function priceGroups(lines: PricedLine[], delivery: Point | null, settings: Settings): PricedGroup[] {
  const byStore = new Map<number, PricedLine[]>();
  for (const line of lines) {
    const bucket = byStore.get(line.offer.store_id) ?? [];
    bucket.push(line);
    byStore.set(line.offer.store_id, bucket);
  }
  return [...byStore.values()].map((storeLines) => {
    const first = storeLines[0].offer;
    const subtotalCents = storeLines.reduce((sum, line) => sum + line.offer.price_cents * line.quantity, 0);
    const distance = delivery ? roundKm(distanceKm({ lat: first.store_lat, lng: first.store_lng }, delivery)) : null;
    const deliveryFeeCents = settings.baseDeliveryFeeCents + Math.round((distance ?? 0) * settings.perKmFeeCents);
    const planRow = sql.get<{ plan: string }>('SELECT plan FROM stores WHERE id = ?', first.store_id);
    const plan = (planRow?.plan ?? 'trial') as PlanId;
    const storeTransport = storeTransportCents(deliveryFeeCents, plan);
    return {
      storeId: first.store_id,
      storeName: first.store_name,
      ownerId: first.owner_id,
      lines: storeLines,
      subtotalCents,
      distanceKm: distance,
      deliveryFeeCents,
      storeTransportCents: storeTransport,
      commissionCents: Math.round((subtotalCents * settings.commissionPercent) / 100),
      totalCents: subtotalCents,
      etaMinutes: distance === null ? null : estimateMinutes(distance),
    };
  });
}

function toQuoteLine(line: PricedLine): QuoteLine {
  return {
    offerId: line.offer.offer_id,
    productId: line.offer.product_id,
    productName: line.offer.product_name,
    quantity: line.quantity,
    unitPriceCents: line.offer.price_cents,
    lineTotalCents: line.offer.price_cents * line.quantity,
  };
}

export function buildQuote(items: CartLine[], delivery?: Point): Quote {
  const groups: QuoteGroup[] = priceGroups(resolveLines(items), delivery ?? null, getSettings()).map((group) => ({
    storeId: group.storeId,
    storeName: group.storeName,
    lines: group.lines.map(toQuoteLine),
    subtotalCents: group.subtotalCents,
    totalCents: group.totalCents,
    distanceKm: group.distanceKm,
    etaMinutes: group.etaMinutes,
  }));
  const sum = (pick: (group: QuoteGroup) => number) => groups.reduce((total, group) => total + pick(group), 0);
  return {
    groups,
    subtotalCents: sum((group) => group.subtotalCents),
    totalCents: sum((group) => group.totalCents),
  };
}

function summarize(lines: PricedLine[]): string {
  return lines.map((line) => `${line.quantity}x ${line.offer.product_name}`).join(', ');
}

export function checkout(buyer: AuthUser, input: z.infer<typeof checkoutSchema>): { checkoutId: string; orders: OrderView[] } {
  const settings = getSettings();
  const groups = priceGroups(resolveLines(input.items), { lat: input.delivery.lat, lng: input.delivery.lng }, settings);
  const checkoutId = crypto.randomUUID();
  const timestamp = now();
  const paymentStatus: PaymentStatus = input.paymentMethod === 'mobile_money' ? 'paid' : 'due';
  const placed: { orderId: number; group: PricedGroup }[] = [];
  const stockChanges: StockChange[] = [];

  tx(() => {
    for (const group of groups) {
      const info = sql.run(
        `INSERT INTO orders (checkout_id, buyer_id, store_id, status, payment_method, payment_status,
           subtotal_cents, delivery_fee_cents, store_transport_cents, commission_cents, total_cents, distance_km,
           dropoff_name, dropoff_phone, dropoff_address, dropoff_lat, dropoff_lng, dropoff_notes,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        checkoutId,
        buyer.id,
        group.storeId,
        'placed',
        input.paymentMethod,
        paymentStatus,
        group.subtotalCents,
        group.deliveryFeeCents,
        group.storeTransportCents,
        group.commissionCents,
        group.totalCents,
        group.distanceKm ?? 0,
        input.delivery.name,
        input.delivery.phone,
        input.delivery.address,
        input.delivery.lat,
        input.delivery.lng,
        input.delivery.notes || null,
        timestamp,
        timestamp,
      );
      const orderId = Number(info.lastInsertRowid);
      for (const line of group.lines) {
        sql.run(
          `INSERT INTO order_items (order_id, offer_id, product_id, product_name, unit_price_cents, quantity, line_total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          orderId,
          line.offer.offer_id,
          line.offer.product_id,
          line.offer.product_name,
          line.offer.price_cents,
          line.quantity,
          line.offer.price_cents * line.quantity,
        );
        stockChanges.push(adjustStock(line.offer.offer_id, -line.quantity));
      }
      addEvent(orderId, 'placed', 'event.placed', buyer.id);
      placed.push({ orderId, group });
    }
  });

  for (const { orderId, group } of placed) {
    const itemCount = group.lines.reduce((sum, line) => sum + line.quantity, 0);
    notify([buyer.id], {
      type: 'order.placed',
      titleKey: 'notif.placed.title',
      bodyKey: 'notif.placed.body',
      params: {
        id: orderId,
        store: group.storeName,
        count: itemCount,
        total: formatMoney(group.totalCents, config.currency),
      },
      data: { orderId, storeId: group.storeId },
    });
    notify([group.ownerId], {
      type: 'order.new',
      titleKey: 'notif.new.title',
      bodyKey: 'notif.new.body',
      params: { id: orderId, buyer: firstName(buyer.name), summary: summarize(group.lines) },
      data: { orderId, storeId: group.storeId },
    });
    const admins = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
    notify(admins, {
      type: 'order.placed',
      titleKey: 'notif.orderUpdate.title',
      bodyKey: 'event.placed',
      params: { id: orderId, status: '@status.placed' },
      data: { orderId, storeId: group.storeId },
    });
  }
  for (const change of stockChanges) emitStockAlerts(change, settings.lowStockThreshold);

  return { checkoutId, orders: placed.map(({ orderId }) => getOrderFor(orderId, buyer)) };
}

interface OrderRow {
  id: number;
  checkout_id: string;
  buyer_id: number;
  store_id: number;
  conductor_id: number | null;
  status: OrderStatus;
  payment_method: 'mobile_money' | 'cash';
  payment_status: PaymentStatus;
  subtotal_cents: number;
  delivery_fee_cents: number;
  store_transport_cents: number;
  commission_cents: number;
  total_cents: number;
  arrived_pickup_at: string | null;
  arrived_dropoff_at: string | null;
  delivery_photo_url: string | null;
  distance_km: number;
  dropoff_name: string;
  dropoff_phone: string | null;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_notes: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  store_name: string;
  store_address: string;
  store_lat: number;
  store_lng: number;
  store_phone: string | null;
  store_owner_id: number;
  buyer_name: string;
  buyer_phone: string | null;
  conductor_name: string | null;
  conductor_phone: string | null;
  conductor_vehicle: VehicleType | null;
  conductor_lat: number | null;
  conductor_lng: number | null;
  conductor_location_at: string | null;
}

const ORDER_SELECT = `SELECT o.id, o.checkout_id, o.buyer_id, o.store_id, o.conductor_id, o.status,
    o.payment_method, o.payment_status, o.subtotal_cents, o.delivery_fee_cents, o.store_transport_cents, o.commission_cents, o.total_cents, o.arrived_pickup_at, o.arrived_dropoff_at, o.delivery_photo_url,
    o.distance_km, o.dropoff_name, o.dropoff_phone, o.dropoff_address, o.dropoff_lat, o.dropoff_lng, o.dropoff_notes,
    o.created_at, o.updated_at, o.delivered_at,
    s.name AS store_name, s.address AS store_address, s.lat AS store_lat, s.lng AS store_lng,
    s.phone AS store_phone, s.owner_id AS store_owner_id,
    b.name AS buyer_name, b.phone AS buyer_phone,
    c.name AS conductor_name, c.phone AS conductor_phone, cd.vehicle AS conductor_vehicle,
    cd.lat AS conductor_lat, cd.lng AS conductor_lng, cd.location_updated_at AS conductor_location_at
  FROM orders o
  JOIN stores s ON s.id = o.store_id
  JOIN users b ON b.id = o.buyer_id
  LEFT JOIN users c ON c.id = o.conductor_id
  LEFT JOIN conductors cd ON cd.user_id = o.conductor_id`;

interface ItemRow {
  id: number;
  order_id: number;
  offer_id: number | null;
  product_id: number;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

interface EventRow {
  order_id: number;
  status: OrderStatus;
  message: string;
  message_key: string | null;
  params: string | null;
  created_at: string;
}

function canView(row: Pick<OrderRow, 'buyer_id' | 'store_owner_id' | 'conductor_id'>, user: AuthUser): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'buyer') return row.buyer_id === user.id;
  if (user.role === 'vendor') return row.store_owner_id === user.id;
  return row.conductor_id === user.id;
}

function etaFor(row: OrderRow): number | null {
  if (!OPEN_STATUSES.includes(row.status)) return null;
  if (row.status === 'out_for_delivery' && row.conductor_lat !== null && row.conductor_lng !== null) {
    return travelMinutes(
      distanceKm({ lat: row.conductor_lat, lng: row.conductor_lng }, { lat: row.dropoff_lat, lng: row.dropoff_lng }),
    );
  }
  const prep = row.status === 'placed' ? 15 : row.status === 'preparing' ? 10 : 0;
  return prep + travelMinutes(row.distance_km);
}

function toView(row: OrderRow, items: ItemRow[], events: EventRow[], viewer: AuthUser): OrderView {
  const isAdmin = viewer.role === 'admin';
  const isOwnBuyer = viewer.role === 'buyer' && viewer.id === row.buyer_id;
  const isVendor = viewer.role === 'vendor';
  const isOwnConductor = viewer.role === 'conductor' && viewer.id === row.conductor_id;
  const seesDriverLocation = isAdmin || isOwnBuyer;
  const seesDropoff = isAdmin || isOwnBuyer || isOwnConductor;
  return {
    id: row.id,
    checkoutId: row.checkout_id,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    subtotalCents: row.subtotal_cents,
    transportFeeCents: row.delivery_fee_cents,
    storeTransportCents: row.store_transport_cents,
    totalCents: row.total_cents,
    arrivedPickupAt: row.arrived_pickup_at,
    arrivedDropoffAt: row.arrived_dropoff_at,
    deliveryPhotoUrl: row.delivery_photo_url,
    distanceKm: row.distance_km,
    etaMinutes: etaFor(row),
    store: {
      id: row.store_id,
      name: row.store_name,
      address: row.store_address,
      lat: row.store_lat,
      lng: row.store_lng,
      phone: row.store_phone,
    },
    buyer: {
      id: row.buyer_id,
      name: isVendor ? firstName(row.buyer_name) : row.buyer_name,
      phone: isAdmin || isOwnBuyer ? row.buyer_phone : null,
    },
    dropoff: seesDropoff
      ? {
          name: row.dropoff_name,
          phone: row.dropoff_phone,
          address: row.dropoff_address,
          lat: row.dropoff_lat,
          lng: row.dropoff_lng,
          notes: row.dropoff_notes,
        }
      : null,
    conductor:
      row.conductor_id !== null && row.conductor_name !== null
        ? {
            id: row.conductor_id,
            name: row.conductor_name,
            vehicle: row.conductor_vehicle ?? 'moto',
            phone: isAdmin || isOwnBuyer || isOwnConductor ? row.conductor_phone : null,
            lat: seesDriverLocation ? row.conductor_lat : null,
            lng: seesDriverLocation ? row.conductor_lng : null,
            locationUpdatedAt: seesDriverLocation ? row.conductor_location_at : null,
          }
        : null,
    items: items.map(
      (item): OrderItem => ({
        id: item.id,
        offerId: item.offer_id,
        productId: item.product_id,
        productName: item.product_name,
        unitPriceCents: item.unit_price_cents,
        quantity: item.quantity,
        lineTotalCents: item.line_total_cents,
      }),
    ),
    events: events.map(
      (event): OrderEvent => ({
        status: event.status,
        messageKey: event.message_key,
        params: event.params ? JSON.parse(event.params) : {},
        message: event.message,
        createdAt: event.created_at,
      }),
    ),
    vendorPayoutCents: isAdmin || isVendor ? row.subtotal_cents - row.commission_cents - row.store_transport_cents : null,
    commissionCents: isAdmin ? row.commission_cents : null,
    conductorEarningCents: isAdmin || isOwnConductor ? row.delivery_fee_cents : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveredAt: row.delivered_at,
  };
}

function toViews(rows: OrderRow[], viewer: AuthUser): OrderView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const marks = placeholders(ids.length);
  const items = sql.all<ItemRow>(
    `SELECT id, order_id, offer_id, product_id, product_name, unit_price_cents, quantity, line_total_cents
     FROM order_items WHERE order_id IN (${marks}) ORDER BY id`,
    ...ids,
  );
  const events = sql.all<EventRow>(
    `SELECT order_id, status, message, message_key, params, created_at FROM order_events WHERE order_id IN (${marks}) ORDER BY id`,
    ...ids,
  );
  return rows.map((row) =>
    toView(
      row,
      items.filter((item) => item.order_id === row.id),
      events.filter((event) => event.order_id === row.id),
      viewer,
    ),
  );
}

function queryViews(where: string, params: Param[], viewer: AuthUser, limit = 200): OrderView[] {
  const rows = sql.all<OrderRow>(`${ORDER_SELECT} WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit}`, ...params);
  return toViews(rows, viewer);
}

function loadOrderRow(orderId: number): OrderRow {
  const row = sql.get<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, orderId);
  if (!row) throw new HttpError(404, 'err.orderNotFound');
  return row;
}

function requireVisibleOrder(orderId: number, user: AuthUser): OrderRow {
  const row = loadOrderRow(orderId);
  if (!canView(row, user)) throw new HttpError(404, 'err.orderNotFound');
  return row;
}

function requireAssignedOrder(orderId: number, conductor: AuthUser): OrderRow {
  const row = loadOrderRow(orderId);
  if (row.conductor_id !== conductor.id) throw new HttpError(403, 'err.notYours');
  return row;
}

function requireStatus(row: OrderRow, allowed: OrderStatus[], key: TranslationKey): void {
  if (!allowed.includes(row.status)) throw new HttpError(409, key);
}

export function getOrderFor(orderId: number, user: AuthUser): OrderView {
  const row = sql.get<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, orderId);
  if (!row || !canView(row, user)) throw new HttpError(404, 'err.orderNotFound');
  return toViews([row], user)[0];
}

export function listBuyerOrders(buyer: AuthUser): OrderView[] {
  return queryViews('o.buyer_id = ?', [buyer.id], buyer);
}

export function listVendorOrders(owner: AuthUser, scope: 'open' | 'done' | 'all'): OrderView[] {
  const filter =
    scope === 'open'
      ? `AND o.status IN (${sqlIn(OPEN_STATUSES)})`
      : scope === 'done'
        ? "AND o.status IN ('delivered', 'rejected', 'cancelled')"
        : '';
  return queryViews(`s.owner_id = ? ${filter}`, [owner.id], owner);
}

export function listConductorHistory(conductor: AuthUser): OrderView[] {
  return queryViews("o.conductor_id = ? AND o.status = 'delivered'", [conductor.id], conductor, 100);
}

export function listAllOrders(status: OrderStatus | undefined, admin: AuthUser): OrderView[] {
  return queryViews(status ? 'o.status = ?' : '1 = 1', status ? [status] : [], admin, 300);
}

export function activeDeliveryFor(conductor: AuthUser): OrderView | null {
  const row = sql.get<{ id: number }>(
    `SELECT id FROM orders WHERE conductor_id = ? AND status IN ('preparing', 'ready', 'out_for_delivery') ORDER BY id DESC LIMIT 1`,
    conductor.id,
  );
  return row ? getOrderFor(row.id, conductor) : null;
}

function addEvent(
  orderId: number,
  status: OrderStatus,
  messageKey: TranslationKey,
  actorId: number | null,
  params: Params = {},
): void {
  sql.run(
    'INSERT INTO order_events (order_id, status, message, message_key, params, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    orderId,
    status,
    translate('en', messageKey, params),
    messageKey,
    JSON.stringify(params),
    actorId,
    now(),
  );
}

function moveOrder(
  orderId: number,
  from: OrderStatus[],
  to: OrderStatus,
  actorId: number,
  messageKey: TranslationKey,
  params: Params = {},
  guard = '1 = 1',
  guardParams: Param[] = [],
): void {
  const info = sql.run(
    `UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status IN (${sqlIn(from)}) AND ${guard}`,
    to,
    now(),
    orderId,
    ...guardParams,
  );
  if (info.changes !== 1) {
    throw new HttpError(409, 'err.orderChanged');
  }
  addEvent(orderId, to, messageKey, actorId, params);
}

function refundIfPaid(orderId: number): void {
  sql.run(
    "UPDATE orders SET payment_status = CASE WHEN payment_status = 'paid' THEN 'refunded' ELSE payment_status END WHERE id = ?",
    orderId,
  );
}

function restockOrder(orderId: number): StockChange[] {
  return sql
    .all<{ offer_id: number | null; quantity: number }>('SELECT offer_id, quantity FROM order_items WHERE order_id = ?', orderId)
    .filter((line): line is { offer_id: number; quantity: number } => line.offer_id !== null)
    .map((line) => adjustStock(line.offer_id, line.quantity));
}

function assignConductor(
  orderId: number,
  expectedConductorId: number | null,
  conductorId: number,
  messageKey: TranslationKey,
  actorId: number | null,
  params: Params = {},
): boolean {
  const info = sql.run(
    `UPDATE orders SET conductor_id = ?, updated_at = ? WHERE id = ? AND status IN (${sqlIn(JOB_STATUSES)}) AND conductor_id IS ?`,
    conductorId,
    now(),
    orderId,
    expectedConductorId,
  );
  if (info.changes !== 1) return false;
  const current = sql.get<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = ?', orderId);
  addEvent(orderId, current?.status ?? 'preparing', messageKey, actorId, params);
  return true;
}

// Order status updates reuse the order event: its title is the order number and status, its body the event text.
function notifyOrderUpdate(
  userIds: number[],
  type: string,
  orderId: number,
  status: OrderStatus,
  messageKey: TranslationKey,
  params: Params = {},
): void {
  notify(userIds, {
    type,
    titleKey: 'notif.orderUpdate.title',
    bodyKey: messageKey,
    params: { id: orderId, status: `@status.${status}`, ...params },
    data: { orderId },
  });
}

function notifyAssigned(row: OrderRow, conductor: { id: number; name: string }, messageKey: TranslationKey): void {
  const data = { orderId: row.id };
  const params = { name: conductor.name };
  notifyOrderUpdate([row.buyer_id], 'order.assigned', row.id, row.status, messageKey, params);
  notifyOrderUpdate([row.store_owner_id], 'order.assigned', row.id, row.status, messageKey, params);
  notify([conductor.id], {
    type: 'job.assigned',
    titleKey: 'notif.jobAssigned.title',
    bodyKey: 'notif.jobAssigned.body',
    params: { id: row.id, store: row.store_name, dropoff: row.dropoff_address },
    data,
  });
}

function nearestTo(point: Point, candidates: IdleConductor[]): IdleConductor | null {
  let best: IdleConductor | null = null;
  let bestKm = Infinity;
  for (const candidate of candidates) {
    const km = distanceKm(point, candidate);
    if (km < bestKm) {
      best = candidate;
      bestKm = km;
    }
  }
  return best;
}

function manualTarget(conductorId: number, row: OrderRow): IdleConductor {
  const user = sql.get<{ name: string; status: string }>(
    "SELECT name, status FROM users WHERE id = ? AND role = 'conductor'",
    conductorId,
  );
  const profile = getConductorProfile(conductorId);
  if (!user || !profile) throw new HttpError(404, 'err.conductorNotFound');
  if (!profile.isOnline || user.status !== 'active') {
    throw new HttpError(409, 'err.conductorOffline');
  }
  if (row.conductor_id !== conductorId && hasActiveDelivery(conductorId)) {
    throw new HttpError(409, 'err.conductorBusy');
  }
  return {
    userId: conductorId,
    name: user.name,
    lat: profile.lat ?? row.store_lat,
    lng: profile.lng ?? row.store_lng,
  };
}

export function vendorAccept(actor: AuthUser, orderId: number): OrderView {
  const row = requireVisibleOrder(orderId, actor);
  requireStatus(row, ['placed'], 'err.onlyNewAccept');
  tx(() => moveOrder(orderId, ['placed'], 'preparing', actor.id, 'event.accepted'));
  notifyOrderUpdate([row.buyer_id], 'order.accepted', orderId, 'preparing', 'event.accepted');
  const adminsAccept = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
  notify(adminsAccept, {
    type: 'order.accepted',
    titleKey: 'notif.orderUpdate.title',
    bodyKey: 'event.accepted',
    params: { id: orderId, status: '@status.preparing' },
    data: { orderId },
  });
  notify(conductorsNear({ lat: row.store_lat, lng: row.store_lng }, getSettings().dispatchRadiusKm), {
    type: 'job.available',
    titleKey: 'notif.jobAvailable.title',
    bodyKey: 'notif.jobAvailable.body',
    params: {
      store: row.store_name,
      dropoff: row.dropoff_address,
      earning: formatMoney(row.delivery_fee_cents, config.currency),
    },
    data: { orderId },
  });
  return getOrderFor(orderId, actor);
}

export function vendorReject(actor: AuthUser, orderId: number, reason?: string): OrderView {
  const row = requireVisibleOrder(orderId, actor);
  requireStatus(row, ['placed'], 'err.onlyNewDecline');
  const messageKey = reason ? 'event.declinedReason' : 'event.declined';
  const params: Params = reason ? { reason } : {};
  const restocked = tx(() => {
    moveOrder(orderId, ['placed'], 'rejected', actor.id, messageKey, params);
    refundIfPaid(orderId);
    return restockOrder(orderId);
  });
  notifyOrderUpdate([row.buyer_id], 'order.rejected', orderId, 'rejected', messageKey, params);
  const adminsRej = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
  notify(adminsRej, { type: 'order.rejected', titleKey: 'notif.orderUpdate.title', bodyKey: messageKey, params: { id: orderId, status: '@status.rejected', ...params }, data: { orderId } });
  for (const change of restocked) emitStockAlerts(change, getSettings().lowStockThreshold);
  return getOrderFor(orderId, actor);
}

export function vendorReady(actor: AuthUser, orderId: number): OrderView {
  const row = requireVisibleOrder(orderId, actor);
  requireStatus(row, ['preparing'], 'err.onlyPreparingReady');
  tx(() => moveOrder(orderId, ['preparing'], 'ready', actor.id, 'event.ready'));
  notifyOrderUpdate([row.buyer_id], 'order.ready', orderId, 'ready', 'event.ready');
  const adminsReady = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
  notify(adminsReady, { type: 'order.ready', titleKey: 'notif.orderUpdate.title', bodyKey: 'event.ready', params: { id: orderId, status: '@status.ready' }, data: { orderId } });
  if (row.conductor_id !== null) {
    notifyOrderUpdate([row.conductor_id], 'order.ready', orderId, 'ready', 'event.ready');
  } else {
    notify(conductorsNear({ lat: row.store_lat, lng: row.store_lng }, getSettings().dispatchRadiusKm), {
      type: 'job.ready',
      titleKey: 'notif.jobReady.title',
      bodyKey: 'notif.jobReady.body',
      params: { id: orderId, store: row.store_name },
      data: { orderId },
    });
  }
  return getOrderFor(orderId, actor);
}

export function buyerCancel(actor: AuthUser, orderId: number): OrderView {
  const row = requireVisibleOrder(orderId, actor);
  requireStatus(row, ['placed'], 'err.cannotCancel');
  const restocked = tx(() => {
    moveOrder(orderId, ['placed'], 'cancelled', actor.id, 'event.cancelled');
    refundIfPaid(orderId);
    return restockOrder(orderId);
  });
  notifyOrderUpdate([actor.id], 'order.cancelled', orderId, 'cancelled', 'event.cancelled');
  notifyOrderUpdate([row.store_owner_id], 'order.cancelled', orderId, 'cancelled', 'event.cancelled');
  const adminsCancel = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
  notify(adminsCancel, {
    type: 'order.cancelled',
    titleKey: 'notif.orderUpdate.title',
    bodyKey: 'event.cancelled',
    params: { id: orderId, status: '@status.cancelled' },
    data: { orderId },
  });
  for (const change of restocked) emitStockAlerts(change, getSettings().lowStockThreshold);
  return getOrderFor(orderId, actor);
}

export function conductorAccept(actor: AuthUser, orderId: number): OrderView {
  const profile = getConductorProfile(actor.id);
  if (!profile?.isOnline) throw new HttpError(409, 'err.goOnline');
  if (hasActiveDelivery(actor.id)) throw new HttpError(409, 'err.finishFirst');
  requireStatus(loadOrderRow(orderId), JOB_STATUSES, 'err.jobUnavailable');
  const params = { name: actor.name };
  const assigned = tx(() => assignConductor(orderId, null, actor.id, 'event.assigned', actor.id, params));
  if (!assigned) throw new HttpError(409, 'err.jobTaken');
  notifyAssigned(loadOrderRow(orderId), { id: actor.id, name: actor.name }, 'event.assigned');
  const adminsAcc = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
  notify(adminsAcc, {
    type: 'order.assigned',
    titleKey: 'notif.orderUpdate.title',
    bodyKey: 'event.assigned',
    params: { id: orderId, status: '@status.preparing', name: actor.name },
    data: { orderId },
  });
  return getOrderFor(orderId, actor);
}

export function conductorArrivePickup(actor: AuthUser, orderId: number): OrderView {
  const row = requireAssignedOrder(orderId, actor);
  requireStatus(row, ['ready'], 'err.notReady');
  const profile = getConductorProfile(actor.id);
  if (!profile || profile.lat === null || profile.lng === null) throw new HttpError(409, 'err.conductorProfile');
  const dist = distanceKm({ lat: profile.lat, lng: profile.lng }, { lat: row.store_lat, lng: row.store_lng });
  if (dist > 0.2) throw new HttpError(409, 'err.notOnLocation');
  sql.run('UPDATE orders SET arrived_pickup_at = ? WHERE id = ?', now(), orderId);
  return getOrderFor(orderId, actor);
}

export function conductorArriveDropoff(actor: AuthUser, orderId: number): OrderView {
  const row = requireAssignedOrder(orderId, actor);
  requireStatus(row, ['out_for_delivery'], 'err.pickupFirst');
  const profile = getConductorProfile(actor.id);
  if (!profile || profile.lat === null || profile.lng === null) throw new HttpError(409, 'err.conductorProfile');
  const dist = distanceKm({ lat: profile.lat, lng: profile.lng }, { lat: row.dropoff_lat, lng: row.dropoff_lng });
  if (dist > 0.2) throw new HttpError(409, 'err.notOnLocation');
  sql.run('UPDATE orders SET arrived_dropoff_at = ? WHERE id = ?', now(), orderId);
  return getOrderFor(orderId, actor);
}

export function conductorPickup(actor: AuthUser, orderId: number): OrderView {
  const row = requireAssignedOrder(orderId, actor);
  requireStatus(row, ['ready'], 'err.notReady');
  const profile = getConductorProfile(actor.id);
  if (!profile || profile.lat === null || profile.lng === null) throw new HttpError(409, 'err.conductorProfile');
  const dist = distanceKm({ lat: profile.lat, lng: profile.lng }, { lat: row.store_lat, lng: row.store_lng });
  if (dist > 0.2) throw new HttpError(409, 'err.notOnLocation');
  const params = { name: actor.name };
  tx(() => {
    moveOrder(orderId, ['ready'], 'out_for_delivery', actor.id, 'event.pickedUp', params, 'conductor_id = ?', [
      actor.id,
    ]);
    sql.run('UPDATE orders SET arrived_pickup_at = ? WHERE id = ?', now(), orderId);
  });
  notifyOrderUpdate([row.buyer_id], 'order.picked_up', orderId, 'out_for_delivery', 'event.pickedUp', params);
  notifyOrderUpdate([row.store_owner_id], 'order.picked_up', orderId, 'out_for_delivery', 'event.pickedUp', params);
  const adminsPickup = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
  notify(adminsPickup, {
    type: 'order.picked_up',
    titleKey: 'notif.orderUpdate.title',
    bodyKey: 'event.pickedUp',
    params: { id: orderId, status: '@status.out_for_delivery', name: actor.name },
    data: { orderId },
  });
  notify([actor.id], {
    type: 'order.picked_up',
    titleKey: 'notif.toDeliver.title',
    bodyKey: 'notif.toDeliver.body',
    params: { id: orderId, customer: row.dropoff_name, dropoff: row.dropoff_address },
    data: { orderId },
  });
  return getOrderFor(orderId, actor);
}

export function conductorDeliver(actor: AuthUser, orderId: number, photoUrl?: string | null): OrderView {
  const row = requireAssignedOrder(orderId, actor);
  requireStatus(row, ['out_for_delivery'], 'err.pickupFirst');
  const profile = getConductorProfile(actor.id);
  if (!profile || profile.lat === null || profile.lng === null) throw new HttpError(409, 'err.conductorProfile');
  const dist = distanceKm({ lat: profile.lat, lng: profile.lng }, { lat: row.dropoff_lat, lng: row.dropoff_lng });
  if (dist > 0.2) throw new HttpError(409, 'err.notOnLocation');
  const deliveredAt = now();
  tx(() => {
    moveOrder(orderId, ['out_for_delivery'], 'delivered', actor.id, 'event.delivered', {}, 'conductor_id = ?', [
      actor.id,
    ]);
    sql.run(
      `UPDATE orders SET delivered_at = ?,
         payment_status = CASE WHEN payment_method = 'cash' THEN 'paid' ELSE payment_status END,
         arrived_dropoff_at = ?, delivery_photo_url = ?
       WHERE id = ?`,
      deliveredAt,
      now(),
      photoUrl || null,
      orderId,
    );
  });
  const data = { orderId };
  notifyOrderUpdate([row.buyer_id], 'order.delivered', orderId, 'delivered', 'event.delivered');
  notify([row.store_owner_id], {
    type: 'order.delivered',
    titleKey: 'notif.payout.title',
    bodyKey: 'notif.payout.body',
    params: { id: orderId, payout: formatMoney(row.subtotal_cents - row.commission_cents - row.store_transport_cents, config.currency) },
    data: { ...data, deliveryPhotoUrl: photoUrl || null },
  });
  const adminsDeliver = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
  notify(adminsDeliver, {
    type: 'order.delivered',
    titleKey: 'notif.orderUpdate.title',
    bodyKey: 'event.delivered',
    params: { id: orderId, status: '@status.delivered' },
    data: { ...data, deliveryPhotoUrl: photoUrl || null },
  });
  notify([actor.id], {
    type: 'order.delivered',
    titleKey: 'notif.earned.title',
    bodyKey: 'notif.earned.body',
    params: { id: orderId, earning: formatMoney(row.delivery_fee_cents, config.currency) },
    data,
  });
  return getOrderFor(orderId, actor);
}

export function adminAssign(actor: AuthUser, orderId: number, conductorId: number | null): OrderView {
  const row = loadOrderRow(orderId);
  requireStatus(row, JOB_STATUSES, 'err.notAssignable');
  const target =
    conductorId === null
      ? nearestTo({ lat: row.store_lat, lng: row.store_lng }, idleOnlineConductors())
      : manualTarget(conductorId, row);
  if (!target) throw new HttpError(409, 'err.noFreeConductor');
  const assigned = tx(() =>
    assignConductor(orderId, row.conductor_id, target.userId, 'event.dispatched', actor.id, { name: target.name }),
  );
  if (!assigned) throw new HttpError(409, 'err.orderMoved');
  if (row.conductor_id !== null && row.conductor_id !== target.userId) {
    notify([row.conductor_id], {
      type: 'job.reassigned',
      titleKey: 'notif.jobReassigned.title',
      bodyKey: 'notif.jobReassigned.body',
      data: { orderId },
    });
  }
  notifyAssigned(loadOrderRow(orderId), { id: target.userId, name: target.name }, 'event.dispatched');
  return getOrderFor(orderId, actor);
}

export function autoDispatch(): { assigned: number; unassigned: number } {
  const open = sql.all<{ id: number; store_lat: number; store_lng: number }>(
    `SELECT o.id, s.lat AS store_lat, s.lng AS store_lng
     FROM orders o JOIN stores s ON s.id = o.store_id
     WHERE o.conductor_id IS NULL AND o.status IN (${sqlIn(JOB_STATUSES)})
     ORDER BY o.created_at ASC`,
  );
  const free = idleOnlineConductors();
  let assigned = 0;
  for (const job of open) {
    const pick = nearestTo({ lat: job.store_lat, lng: job.store_lng }, free);
    if (!pick) break;
    const done = tx(() => assignConductor(job.id, null, pick.userId, 'event.autoDispatched', null, { name: pick.name }));
    if (!done) continue;
    assigned += 1;
    free.splice(free.indexOf(pick), 1);
    notifyAssigned(loadOrderRow(job.id), { id: pick.userId, name: pick.name }, 'event.autoDispatched');
  }
  return { assigned, unassigned: open.length - assigned };
}
