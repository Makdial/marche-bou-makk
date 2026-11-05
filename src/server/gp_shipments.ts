import { z } from 'zod';
import { getGpProfile } from './accounts';
import { now, sql } from './db';
import { HttpError } from './http';
import { notify } from './notifications';
import { PACKAGE_SELECT, loadPackage, notifyPackage, notifyPackageJob, toPackageView, type PackageRow } from './packages';
import { phoneKey } from '../shared/phone';
import type { PackageView } from '../shared/types';

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const shipmentSchema = z.object({
  senderName: z.string().trim().min(2).max(100),
  senderPhone: z.string().trim().min(5).max(30),
  receiverName: z.string().trim().min(2).max(100),
  receiverPhone: z.string().trim().min(5).max(30),
  receiverAddress: z.string().trim().min(5).max(200),
  receiverLat: latitude,
  receiverLng: longitude,
  photoUrl: z.string().trim().max(500).nullable().optional(),
  weightKg: z.number().positive().max(1000),
  priceCents: z.number().int().min(0).max(100000000),
});

function ownRow(gpUserId: number, id: number): PackageRow {
  const row = loadPackage(id);
  if (row.gp_user_id !== gpUserId) throw new HttpError(404, 'err.packageNotFound');
  return row;
}

export function listShipments(gpUserId: number): PackageView[] {
  return sql
    .all<PackageRow>(`${PACKAGE_SELECT} WHERE p.gp_user_id = ? ORDER BY p.id DESC`, gpUserId)
    .map((row) => toPackageView(row, 'gp'));
}

export function createShipment(gpUserId: number, input: z.infer<typeof shipmentSchema>): PackageView {
  const info = sql.run(
    `INSERT INTO gp_shipments (gp_user_id, sender_name, sender_phone, receiver_name, receiver_phone, receiver_phone_key,
       receiver_address, receiver_lat, receiver_lng, photo_url, weight_kg, price_cents, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?)`,
    gpUserId,
    input.senderName,
    input.senderPhone,
    input.receiverName,
    input.receiverPhone,
    phoneKey(input.receiverPhone),
    input.receiverAddress,
    input.receiverLat,
    input.receiverLng,
    input.photoUrl || null,
    input.weightKg,
    input.priceCents,
    now(),
  );
  const row = loadPackage(Number(info.lastInsertRowid));
  notify([gpUserId], {
    type: 'gp.shipment.registered',
    titleKey: 'notif.gpRegistered.title',
    bodyKey: 'notif.gpRegistered.body',
    params: { sender: row.sender_name, receiver: row.receiver_name, weight: row.weight_kg },
    data: { shipmentId: row.id },
  });
  notifyPackage(row, 'registered', { includeGp: false });
  const admins = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  notify(
    admins.map((a) => a.id),
    {
      type: 'gp.shipment.registered',
      titleKey: 'notif.gpNew.title',
      bodyKey: 'notif.gpNew.body',
      params: { sender: row.sender_name, receiver: row.receiver_name, weight: row.weight_kg },
      data: { shipmentId: row.id, gpUserId },
    },
  );
  return toPackageView(row, 'gp');
}

export function updateShipment(gpUserId: number, id: number, input: z.infer<typeof shipmentSchema>): PackageView {
  const row = ownRow(gpUserId, id);
  if (row.status !== 'registered' && !(row.status === 'picked_up' && row.conductor_id === null)) {
    throw new HttpError(409, 'err.packageChanged');
  }
  const photoUrl = input.photoUrl === undefined ? row.photo_url : input.photoUrl || null;
  sql.run(
    `UPDATE gp_shipments SET sender_name = ?, sender_phone = ?, receiver_name = ?, receiver_phone = ?, receiver_phone_key = ?,
       receiver_address = ?, receiver_lat = ?, receiver_lng = ?, photo_url = ?, weight_kg = ?, price_cents = ?
     WHERE id = ?`,
    input.senderName,
    input.senderPhone,
    input.receiverName,
    input.receiverPhone,
    phoneKey(input.receiverPhone),
    input.receiverAddress,
    input.receiverLat,
    input.receiverLng,
    photoUrl,
    input.weightKg,
    input.priceCents,
    id,
  );
  return toPackageView(loadPackage(id), 'gp');
}

export function deleteShipment(gpUserId: number, id: number): void {
  const row = ownRow(gpUserId, id);
  if (row.status !== 'registered') throw new HttpError(409, 'err.packageChanged');
  sql.run('DELETE FROM gp_shipments WHERE id = ?', id);
}

// Step 2: the GP has the package and it is ready at their Senegal drop-off. Conductors near that point can take it.
export function markPickedUp(gpUserId: number, id: number): PackageView {
  const row = ownRow(gpUserId, id);
  if (row.status !== 'registered') throw new HttpError(409, 'err.packageChanged');
  const profile = getGpProfile(gpUserId);
  if (!profile || profile.dropoffLat === null || profile.dropoffLng === null) {
    throw new HttpError(409, 'err.gpDropoffMissing');
  }
  if (row.receiver_lat === null || row.receiver_lng === null) throw new HttpError(409, 'err.packageNeedsAddress');
  const info = sql.run(
    "UPDATE gp_shipments SET status = 'picked_up', picked_up_at = ?, pickup_address = ?, pickup_lat = ?, pickup_lng = ? WHERE id = ? AND status = 'registered'",
    now(),
    profile.dropoffAddress,
    profile.dropoffLat,
    profile.dropoffLng,
    id,
  );
  if (info.changes !== 1) throw new HttpError(409, 'err.packageChanged');
  const updated = loadPackage(id);
  notifyPackage(updated, 'pickedUp');
  notifyPackageJob(updated);
  return toPackageView(updated, 'gp');
}

// Final step without a conductor: the receiver collects the package at the drop-off and the GP confirms with a photo.
export function markHandedOver(gpUserId: number, id: number, proofPhotoUrl?: string | null): PackageView {
  const row = ownRow(gpUserId, id);
  if (row.status !== 'picked_up') throw new HttpError(409, 'err.packageChanged');
  if (row.conductor_id !== null) throw new HttpError(409, 'err.packageTaken');
  const info = sql.run(
    "UPDATE gp_shipments SET status = 'delivered', delivered_at = ?, proof_photo_url = COALESCE(?, proof_photo_url) WHERE id = ? AND status = 'picked_up' AND conductor_id IS NULL",
    now(),
    proofPhotoUrl || null,
    id,
  );
  if (info.changes !== 1) throw new HttpError(409, 'err.packageChanged');
  const updated = loadPackage(id);
  notifyPackage(updated, 'delivered', { includeGp: false });
  return toPackageView(updated, 'gp');
}
