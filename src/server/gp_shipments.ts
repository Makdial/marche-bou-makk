import { now, sql, type Param } from './db';
import { HttpError } from './http';
import { notify } from './notifications';
import { z } from 'zod';

export interface GpShipment {
  id: number;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
  photoUrl: string | null;
  weightKg: number;
  priceCents: number;
  status: 'registered' | 'picked_up' | 'delivered';
  proofPhotoUrl: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

interface Row {
  id: number;
  sender_name: string;
  sender_phone: string;
  receiver_name: string;
  receiver_phone: string;
  photo_url: string | null;
  weight_kg: number;
  price_cents: number;
  status: string;
  proof_photo_url: string | null;
  created_at: string;
  delivered_at: string | null;
}

function toShipment(row: Row): GpShipment {
  return {
    id: row.id,
    senderName: row.sender_name,
    senderPhone: row.sender_phone,
    receiverName: row.receiver_name,
    receiverPhone: row.receiver_phone,
    photoUrl: row.photo_url,
    weightKg: row.weight_kg,
    priceCents: row.price_cents,
    status: row.status as GpShipment['status'],
    proofPhotoUrl: row.proof_photo_url,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

export function listShipments(gpUserId: number): GpShipment[] {
  return sql.all<Row>('SELECT * FROM gp_shipments WHERE gp_user_id = ? ORDER BY id DESC', gpUserId).map(toShipment);
}

export const shipmentSchema = z.object({
  senderName: z.string().trim().min(2).max(100),
  senderPhone: z.string().trim().min(5).max(30),
  receiverName: z.string().trim().min(2).max(100),
  receiverPhone: z.string().trim().min(5).max(30),
  photoUrl: z.string().trim().max(500).nullable().optional(),
  weightKg: z.number().positive().max(1000),
  priceCents: z.number().int().min(0).max(100000000),
});

export function createShipment(gpUserId: number, input: z.infer<typeof shipmentSchema>): GpShipment {
  const info = sql.run(
    `INSERT INTO gp_shipments (gp_user_id, sender_name, sender_phone, receiver_name, receiver_phone, photo_url, weight_kg, price_cents, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?)`,
    gpUserId,
    input.senderName,
    input.senderPhone,
    input.receiverName,
    input.receiverPhone,
    input.photoUrl || null,
    input.weightKg,
    input.priceCents,
    now(),
  );
  const row = sql.get<Row>('SELECT * FROM gp_shipments WHERE id = ?', Number(info.lastInsertRowid));
  const shipment = toShipment(row!);
  notify([gpUserId], {
    type: 'gp.shipment.registered',
    titleKey: 'notif.gpRegistered.title',
    bodyKey: 'notif.gpRegistered.body',
    params: { sender: shipment.senderName, receiver: shipment.receiverName, weight: shipment.weightKg },
    data: { shipmentId: shipment.id },
  });
  const admins = sql.all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  notify(admins.map((a) => a.id), {
    type: 'gp.shipment.registered',
    titleKey: 'notif.gpNew.title',
    bodyKey: 'notif.gpNew.body',
    params: { sender: shipment.senderName, receiver: shipment.receiverName, weight: shipment.weightKg },
    data: { shipmentId: shipment.id, gpUserId },
  });
  return shipment;
}

export function updateShipmentStatus(gpUserId: number, id: number, status: 'picked_up' | 'delivered', proofPhotoUrl?: string | null): GpShipment {
  const row = sql.get<Row>('SELECT * FROM gp_shipments WHERE id = ? AND gp_user_id = ?', id, gpUserId);
  if (!row) throw new HttpError(404, 'err.orderNotFound');
  if (status === 'delivered') {
    sql.run('UPDATE gp_shipments SET status = ?, delivered_at = ?, proof_photo_url = COALESCE(?, proof_photo_url) WHERE id = ?', 'delivered', now(), proofPhotoUrl ?? null, id);
  } else {
    sql.run('UPDATE gp_shipments SET status = ? WHERE id = ?', 'picked_up', id);
  }
  const updated = sql.get<Row>('SELECT * FROM gp_shipments WHERE id = ?', id);
  return toShipment(updated!);
}

export function deleteShipment(gpUserId: number, id: number): void {
  const row = sql.get<Row>('SELECT * FROM gp_shipments WHERE id = ? AND gp_user_id = ?', id, gpUserId);
  if (!row) throw new HttpError(404, 'err.orderNotFound');
  sql.run('DELETE FROM gp_shipments WHERE id = ?', id);
}
export function updateShipment(gpUserId: number, id: number, input: z.infer<typeof shipmentSchema>): GpShipment {
  const row = sql.get<Row>('SELECT * FROM gp_shipments WHERE id = ? AND gp_user_id = ?', id, gpUserId);
  if (!row) throw new HttpError(404, 'err.orderNotFound');
  const photoUrl = input.photoUrl === undefined ? row.photo_url : (input.photoUrl || null);
  sql.run(
    `UPDATE gp_shipments SET sender_name = ?, sender_phone = ?, receiver_name = ?, receiver_phone = ?, photo_url = ?, weight_kg = ?, price_cents = ? WHERE id = ?`,
    input.senderName,
    input.senderPhone,
    input.receiverName,
    input.receiverPhone,
    photoUrl,
    input.weightKg,
    input.priceCents,
    id,
  );
  const updated = sql.get<Row>('SELECT * FROM gp_shipments WHERE id = ?', id);
  return toShipment(updated!);
}
