import { now, sql, sqlIn } from './db';
import { HttpError } from './http';
import { pushEvent } from './notifications';
import { getSettings } from './settings';
import { distanceKm, estimateMinutes, roundKm } from '../shared/geo';
import type { TranslationKey } from '../shared/i18n/en';
import { DELIVERY_STATUSES, JOB_STATUSES } from '../shared/status';
import type { ConductorJob, ConductorProfile, Point, VehicleType } from '../shared/types';

interface ConductorRow {
  user_id: number;
  vehicle: VehicleType;
  address: string | null;
  is_online: number;
  lat: number | null;
  lng: number | null;
  location_updated_at: string | null;
}

export interface IdleConductor extends Point {
  userId: number;
  name: string;
}

export function getConductorProfile(userId: number): ConductorProfile | null {
  const row = sql.get<ConductorRow>(
    'SELECT user_id, vehicle, address, is_online, lat, lng, location_updated_at FROM conductors WHERE user_id = ?',
    userId,
  );
  if (!row) return null;
  return {
    userId: row.user_id,
    vehicle: row.vehicle,
    address: row.address,
    isOnline: row.is_online === 1,
    lat: row.lat,
    lng: row.lng,
    locationUpdatedAt: row.location_updated_at,
  };
}

function requireProfile(userId: number): ConductorProfile {
  const profile = getConductorProfile(userId);
  if (!profile) throw new HttpError(404, 'err.conductorProfile');
  return profile;
}

export function hasActiveDelivery(userId: number): boolean {
  return !!sql.get(
    `SELECT 1 AS found FROM orders WHERE conductor_id = ? AND status IN (${sqlIn(DELIVERY_STATUSES)}) LIMIT 1`,
    userId,
  );
}

export function setOnline(userId: number, isOnline: boolean): ConductorProfile {
  if (!isOnline && hasActiveDelivery(userId)) {
    throw new HttpError(409, 'err.finishBeforeOffline');
  }
  sql.run('UPDATE conductors SET is_online = ? WHERE user_id = ?', isOnline ? 1 : 0, userId);
  return requireProfile(userId);
}

export function updateAddress(userId: number, address: string): void {
  sql.run('UPDATE conductors SET address = ? WHERE user_id = ?', address.trim() || null, userId);
}

export function updateLocation(userId: number, point: Point): void {
  sql.run(
    'UPDATE conductors SET lat = ?, lng = ?, location_updated_at = ? WHERE user_id = ?',
    point.lat,
    point.lng,
    now(),
    userId,
  );
  // Broadcast the new position to everyone watching this delivery.
  const order = sql.get<{ id: number; buyer_id: number; store_owner_id: number }>(
    `SELECT o.id, o.buyer_id, s.owner_id AS store_owner_id
     FROM orders o JOIN stores s ON s.id = o.store_id
     WHERE o.conductor_id = ? AND o.status IN ('preparing', 'ready', 'out_for_delivery')`,
    userId,
  );
  if (!order) return;
  const payload = { conductorId: userId, lat: point.lat, lng: point.lng, orderId: order.id };
  pushEvent(order.buyer_id, 'location', payload);
  pushEvent(order.store_owner_id, 'location', payload);
  const admins = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  for (const admin of admins) pushEvent(admin.id, 'location', payload);
}

// Online, approved conductors with a known position and no delivery in progress.
export function idleOnlineConductors(): IdleConductor[] {
  return sql.all<IdleConductor>(
    `SELECT c.user_id AS userId, u.name, c.lat, c.lng
     FROM conductors c
     JOIN users u ON u.id = c.user_id
     WHERE c.is_online = 1 AND u.status = 'active' AND c.lat IS NOT NULL AND c.lng IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM orders o WHERE o.conductor_id = c.user_id AND o.status IN (${sqlIn(DELIVERY_STATUSES)})
       )`,
  );
}

export function conductorsNear(point: Point, radiusKm: number): number[] {
  return idleOnlineConductors()
    .filter((conductor) => distanceKm(point, conductor) <= radiusKm)
    .map((conductor) => conductor.userId);
}

interface JobRow {
  id: number;
  status: ConductorJob['status'];
  created_at: string;
  distance_km: number;
  delivery_fee_cents: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  store_name: string;
  store_address: string;
  store_lat: number;
  store_lng: number;
  item_count: number;
}

export function jobBoard(profile: ConductorProfile): { jobs: ConductorJob[]; note: TranslationKey | null } {
  if (!profile.isOnline) return { jobs: [], note: 'conductor.jobsNote.goOnline' };
  if (hasActiveDelivery(profile.userId)) {
    return { jobs: [], note: 'conductor.jobsNote.finishFirst' };
  }
  const radiusKm = getSettings().dispatchRadiusKm;
  const origin = profile.lat !== null && profile.lng !== null ? { lat: profile.lat, lng: profile.lng } : null;
  const rows = sql.all<JobRow>(
    `SELECT o.id, o.status, o.created_at, o.distance_km, o.delivery_fee_cents,
       o.dropoff_address, o.dropoff_lat, o.dropoff_lng,
       s.name AS store_name, s.address AS store_address, s.lat AS store_lat, s.lng AS store_lng,
       (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i WHERE i.order_id = o.id) AS item_count
     FROM orders o
     JOIN stores s ON s.id = o.store_id
     WHERE o.conductor_id IS NULL AND o.status IN (${sqlIn(JOB_STATUSES)})
     ORDER BY o.created_at ASC
     LIMIT 200`,
  );
  const jobs = rows
    .map((row): ConductorJob => {
      const toPickup = origin ? roundKm(distanceKm(origin, { lat: row.store_lat, lng: row.store_lng })) : null;
      return {
        id: row.id,
        status: row.status,
        storeName: row.store_name,
        pickupAddress: row.store_address,
        pickupLat: row.store_lat,
        pickupLng: row.store_lng,
        dropoffAddress: row.dropoff_address,
        dropoffLat: row.dropoff_lat,
        dropoffLng: row.dropoff_lng,
        tripKm: roundKm(row.distance_km),
        distanceToPickupKm: toPickup,
        earningCents: row.delivery_fee_cents,
        itemCount: row.item_count,
        etaMinutes: estimateMinutes((toPickup ?? 0) + row.distance_km),
        createdAt: row.created_at,
      };
    })
    .filter((job) => job.distanceToPickupKm === null || job.distanceToPickupKm <= radiusKm)
    .sort((a, b) => (a.distanceToPickupKm ?? 0) - (b.distanceToPickupKm ?? 0));
  return {
    jobs,
    note: origin ? null : 'conductor.jobsNote.shareLocation',
  };
}

export function conductorStats(userId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const totals = sql.get<{ n: number; earned: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(delivery_fee_cents), 0) AS earned
     FROM orders WHERE conductor_id = ? AND status = 'delivered'`,
    userId,
  );
  const todays = sql.get<{ n: number; earned: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(delivery_fee_cents), 0) AS earned
     FROM orders WHERE conductor_id = ? AND status = 'delivered' AND substr(delivered_at, 1, 10) = ?`,
    userId,
    today,
  );
  return {
    deliveriesTotal: totals?.n ?? 0,
    deliveredToday: todays?.n ?? 0,
    earningsTotalCents: totals?.earned ?? 0,
    earningsTodayCents: todays?.earned ?? 0,
  };
}
