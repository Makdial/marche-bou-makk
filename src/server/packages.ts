import { now, sql } from './db';
import { HttpError } from './http';
import { notify } from './notifications';
import { conductorsNear, getConductorProfile, hasActiveDelivery } from './conductors';
import { getSettings } from './settings';
import type { AuthUser } from './auth';
import { distanceKm, estimateMinutes, roundKm } from '../shared/geo';
import { phoneKey } from '../shared/phone';
import type { TranslationKey } from '../shared/i18n/en';
import type { ConductorJob, ConductorProfile, PackageStatus, PackageView, VehicleType } from '../shared/types';

// A conductor counts as "at the location" within 200 metres, the same rule as for store orders.
const AT_LOCATION_KM = 0.2;

export type Audience = 'gp' | 'receiver' | 'conductor';
export type PackageEvent = 'registered' | 'pickedUp' | 'assigned' | 'onTheWay' | 'delivered';

const EVENT_TEXT: Record<PackageEvent, TranslationKey> = {
  registered: 'notif.package.registered',
  pickedUp: 'notif.package.pickedUp',
  assigned: 'notif.package.assigned',
  onTheWay: 'notif.package.onTheWay',
  delivered: 'notif.package.delivered',
};

export interface PackageRow {
  id: number;
  gp_user_id: number;
  gp_name: string;
  gp_country: string | null;
  sender_name: string;
  sender_phone: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string | null;
  receiver_lat: number | null;
  receiver_lng: number | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  photo_url: string | null;
  weight_kg: number;
  price_cents: number;
  status: PackageStatus;
  proof_photo_url: string | null;
  conductor_id: number | null;
  conductor_name: string | null;
  conductor_vehicle: VehicleType | null;
  created_at: string;
  assigned_at: string | null;
  picked_up_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
}

export const PACKAGE_SELECT = `SELECT p.id, p.gp_user_id, gu.name AS gp_name, g.country AS gp_country,
    p.sender_name, p.sender_phone, p.receiver_name, p.receiver_phone, p.receiver_address, p.receiver_lat, p.receiver_lng,
    p.pickup_address, p.pickup_lat, p.pickup_lng, p.photo_url, p.weight_kg, p.price_cents, p.status, p.proof_photo_url,
    p.conductor_id, cu.name AS conductor_name, cd.vehicle AS conductor_vehicle, p.created_at, p.assigned_at,
    p.picked_up_at, p.out_for_delivery_at, p.delivered_at
  FROM gp_shipments p
  JOIN users gu ON gu.id = p.gp_user_id
  LEFT JOIN gp_profiles g ON g.user_id = p.gp_user_id
  LEFT JOIN users cu ON cu.id = p.conductor_id
  LEFT JOIN conductors cd ON cd.user_id = p.conductor_id`;

export function toPackageView(row: PackageRow, audience: Audience): PackageView {
  return {
    id: row.id,
    status: row.status,
    gp: { id: row.gp_user_id, name: row.gp_name, country: row.gp_country },
    senderName: row.sender_name,
    senderPhone: audience === 'gp' ? row.sender_phone : null,
    receiverName: row.receiver_name,
    receiverPhone: audience === 'receiver' ? null : row.receiver_phone,
    receiverAddress: row.receiver_address,
    receiverLat: row.receiver_lat,
    receiverLng: row.receiver_lng,
    pickupAddress: row.pickup_address,
    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    weightKg: row.weight_kg,
    priceCents: row.price_cents,
    photoUrl: row.photo_url,
    proofPhotoUrl: row.proof_photo_url,
    conductor:
      row.conductor_id !== null && row.conductor_name
        ? { id: row.conductor_id, name: row.conductor_name, vehicle: row.conductor_vehicle ?? 'moto' }
        : null,
    createdAt: row.created_at,
    assignedAt: row.assigned_at,
    pickedUpAt: row.picked_up_at,
    outForDeliveryAt: row.out_for_delivery_at,
    deliveredAt: row.delivered_at,
  };
}

export function loadPackage(id: number): PackageRow {
  const row = sql.get<PackageRow>(`${PACKAGE_SELECT} WHERE p.id = ?`, id);
  if (!row) throw new HttpError(404, 'err.packageNotFound');
  return row;
}

// Shoppers whose account phone number matches the receiver's number.
function receiverIds(receiverPhone: string): number[] {
  const key = phoneKey(receiverPhone);
  if (!key) return [];
  return sql
    .all<{ id: number; phone: string }>("SELECT id, phone FROM users WHERE role = 'buyer' AND status = 'active' AND phone IS NOT NULL")
    .filter((user) => phoneKey(user.phone) === key)
    .map((user) => user.id);
}

export function notifyPackage(row: PackageRow, event: PackageEvent, options: { includeGp?: boolean } = {}): void {
  const gpIds = options.includeGp === false ? [] : [row.gp_user_id];
  notify([...gpIds, ...receiverIds(row.receiver_phone)], {
    type: `package.${event}`,
    titleKey: 'notif.package.title',
    bodyKey: EVENT_TEXT[event],
    params: { sender: row.sender_name, receiver: row.receiver_name },
    data: { packageId: row.id },
  });
}

// Tells the conductors near the GP drop-off that a package can be collected.
export function notifyPackageJob(row: PackageRow): void {
  if (row.pickup_lat === null || row.pickup_lng === null) return;
  notify(conductorsNear({ lat: row.pickup_lat, lng: row.pickup_lng }, getSettings().dispatchRadiusKm), {
    type: 'job.package',
    titleKey: 'notif.packageJob.title',
    bodyKey: 'notif.packageJob.body',
    params: { pickup: row.pickup_address ?? '', dropoff: row.receiver_address ?? '' },
    data: { packageId: row.id },
  });
}

export function listReceiverPackages(user: AuthUser): PackageView[] {
  const me = sql.get<{ phone: string | null }>('SELECT phone FROM users WHERE id = ?', user.id);
  const key = phoneKey(me?.phone);
  if (!key) return [];
  return sql
    .all<PackageRow>(`${PACKAGE_SELECT} WHERE p.receiver_phone_key = ? ORDER BY p.id DESC LIMIT 200`, key)
    .map((row) => toPackageView(row, 'receiver'));
}

export function activePackageFor(conductor: AuthUser): PackageView | null {
  const row = sql.get<PackageRow>(
    `${PACKAGE_SELECT} WHERE p.conductor_id = ? AND p.status IN ('picked_up', 'out_for_delivery') ORDER BY p.id DESC LIMIT 1`,
    conductor.id,
  );
  return row ? toPackageView(row, 'conductor') : null;
}

// Packages waiting for a conductor, shown on the job board next to store orders.
export function packageJobs(profile: ConductorProfile): ConductorJob[] {
  if (!profile.isOnline || hasActiveDelivery(profile.userId)) return [];
  const radiusKm = getSettings().dispatchRadiusKm;
  const origin = profile.lat !== null && profile.lng !== null ? { lat: profile.lat, lng: profile.lng } : null;
  const rows = sql.all<PackageRow>(
    `${PACKAGE_SELECT}
     WHERE p.status = 'picked_up' AND p.conductor_id IS NULL
       AND p.pickup_lat IS NOT NULL AND p.receiver_lat IS NOT NULL
     ORDER BY p.picked_up_at ASC LIMIT 200`,
  );
  return rows
    .map((row): ConductorJob => {
      const pickup = { lat: row.pickup_lat ?? 0, lng: row.pickup_lng ?? 0 };
      const dropoff = { lat: row.receiver_lat ?? 0, lng: row.receiver_lng ?? 0 };
      const tripKm = roundKm(distanceKm(pickup, dropoff));
      const toPickup = origin ? roundKm(distanceKm(origin, pickup)) : null;
      return {
        id: row.id,
        kind: 'package',
        status: 'picked_up',
        storeName: row.gp_name,
        pickupAddress: row.pickup_address ?? '',
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffAddress: row.receiver_address ?? '',
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        tripKm,
        distanceToPickupKm: toPickup,
        earningCents: 0,
        itemCount: 1,
        etaMinutes: estimateMinutes((toPickup ?? 0) + tripKm),
        createdAt: row.picked_up_at ?? row.created_at,
      };
    })
    .filter((job) => job.distanceToPickupKm === null || job.distanceToPickupKm <= radiusKm);
}

function assignedTo(actor: AuthUser, id: number): PackageRow {
  const row = loadPackage(id);
  if (row.conductor_id !== actor.id) throw new HttpError(403, 'err.notYours');
  return row;
}

function requireAtLocation(actor: AuthUser, lat: number | null, lng: number | null): void {
  const profile = getConductorProfile(actor.id);
  if (!profile || profile.lat === null || profile.lng === null) throw new HttpError(409, 'err.conductorProfile');
  if (lat === null || lng === null || distanceKm({ lat: profile.lat, lng: profile.lng }, { lat, lng }) > AT_LOCATION_KM) {
    throw new HttpError(409, 'err.notOnLocation');
  }
}

export function acceptPackage(actor: AuthUser, id: number): PackageView {
  const profile = getConductorProfile(actor.id);
  if (!profile?.isOnline) throw new HttpError(409, 'err.goOnline');
  if (hasActiveDelivery(actor.id)) throw new HttpError(409, 'err.finishFirst');
  const info = sql.run(
    "UPDATE gp_shipments SET conductor_id = ?, assigned_at = ? WHERE id = ? AND status = 'picked_up' AND conductor_id IS NULL",
    actor.id,
    now(),
    id,
  );
  if (info.changes !== 1) {
    const current = loadPackage(id);
    throw new HttpError(409, current.conductor_id !== null ? 'err.packageTaken' : 'err.jobUnavailable');
  }
  const row = loadPackage(id);
  notifyPackage(row, 'assigned');
  return toPackageView(row, 'conductor');
}

export function pickupPackage(actor: AuthUser, id: number): PackageView {
  const row = assignedTo(actor, id);
  if (row.status !== 'picked_up') throw new HttpError(409, 'err.packageChanged');
  requireAtLocation(actor, row.pickup_lat, row.pickup_lng);
  const info = sql.run(
    "UPDATE gp_shipments SET status = 'out_for_delivery', out_for_delivery_at = ? WHERE id = ? AND conductor_id = ? AND status = 'picked_up'",
    now(),
    id,
    actor.id,
  );
  if (info.changes !== 1) throw new HttpError(409, 'err.packageChanged');
  const updated = loadPackage(id);
  notifyPackage(updated, 'onTheWay');
  return toPackageView(updated, 'conductor');
}

export function deliverPackage(actor: AuthUser, id: number, photoUrl?: string | null): PackageView {
  const row = assignedTo(actor, id);
  if (row.status !== 'out_for_delivery') throw new HttpError(409, 'err.pickupFirst');
  requireAtLocation(actor, row.receiver_lat, row.receiver_lng);
  const info = sql.run(
    "UPDATE gp_shipments SET status = 'delivered', delivered_at = ?, proof_photo_url = COALESCE(?, proof_photo_url) WHERE id = ? AND conductor_id = ? AND status = 'out_for_delivery'",
    now(),
    photoUrl || null,
    id,
    actor.id,
  );
  if (info.changes !== 1) throw new HttpError(409, 'err.packageChanged');
  const updated = loadPackage(id);
  notifyPackage(updated, 'delivered');
  return toPackageView(updated, 'conductor');
}
