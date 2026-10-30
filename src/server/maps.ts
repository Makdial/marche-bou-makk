import { sql, sqlIn } from './db';
import { HttpError } from './http';
import { DELIVERY_STATUSES, OPEN_STATUSES } from '../shared/status';
import type { AdminMap, OrderStatus, PublicGp, PublicStore, UserStatus, VehicleType, VendorMap } from '../shared/types';

export function publicGps(): PublicGp[] {
  return sql
    .all<{ id: number; name: string; country: string | null; dropoff_address: string | null; dropoff_lat: number; dropoff_lng: number }>(
      `SELECT u.id, u.name, g.country, g.dropoff_address, g.dropoff_lat, g.dropoff_lng
       FROM gp_profiles g JOIN users u ON u.id = g.user_id
       WHERE u.status = 'active' AND g.dropoff_lat IS NOT NULL AND g.dropoff_lng IS NOT NULL`,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      country: row.country,
      address: row.dropoff_address,
      lat: row.dropoff_lat,
      lng: row.dropoff_lng,
    }));
}

export function publicStores(): PublicStore[] {
  return sql
    .all<{ id: number; name: string; description: string | null; address: string; lat: number; lng: number; banner_url: string | null; website: string | null; open_time: string | null; close_time: string | null; product_count: number }>(
      `SELECT s.id, s.name, s.description, s.address, s.lat, s.lng, s.banner_url, s.website, s.open_time, s.close_time,
         (SELECT COUNT(*) FROM offers o WHERE o.store_id = s.id AND o.is_active = 1 AND o.stock > 0) AS product_count
       FROM stores s
       JOIN users u ON u.id = s.owner_id
       WHERE u.status = 'active' AND (s.sells_until IS NULL OR s.sells_until > datetime('now'))
       ORDER BY s.name`,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      bannerUrl: row.banner_url,
      website: row.website,
      openTime: row.open_time,
      closeTime: row.close_time,
      productCount: row.product_count,
    }));
}

export function adminMap(): AdminMap {
  const stores = sql.all<{ id: number; name: string; address: string; lat: number; lng: number; status: UserStatus }>(
    `SELECT s.id, s.name, s.address, s.lat, s.lng, u.status
     FROM stores s JOIN users u ON u.id = s.owner_id`,
  );
  const conductors = sql.all<{
    id: number;
    name: string;
    vehicle: VehicleType;
    lat: number;
    lng: number;
    is_online: number;
    updated_at: string | null;
    order_id: number | null;
  }>(
    `SELECT c.user_id AS id, u.name, c.vehicle, c.lat, c.lng, c.is_online, c.location_updated_at AS updated_at,
       (SELECT o.id FROM orders o WHERE o.conductor_id = c.user_id AND o.status IN (${sqlIn(DELIVERY_STATUSES)}) ORDER BY o.id DESC LIMIT 1) AS order_id
     FROM conductors c JOIN users u ON u.id = c.user_id
     WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND u.status = 'active'`,
  );
  const orders = sql.all<{
    id: number;
    status: OrderStatus;
    store_name: string;
    store_lat: number;
    store_lng: number;
    dropoff_address: string;
    dropoff_lat: number;
    dropoff_lng: number;
    conductor_id: number | null;
  }>(
    `SELECT o.id, o.status, s.name AS store_name, s.lat AS store_lat, s.lng AS store_lng,
       o.dropoff_address, o.dropoff_lat, o.dropoff_lng, o.conductor_id
     FROM orders o JOIN stores s ON s.id = o.store_id
     WHERE o.status IN (${sqlIn(OPEN_STATUSES)})
     ORDER BY o.id DESC`,
  );
  return {
    stores: stores.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      status: row.status,
    })),
    conductors: conductors.map((row) => ({
      id: row.id,
      name: row.name,
      vehicle: row.vehicle,
      lat: row.lat,
      lng: row.lng,
      online: row.is_online === 1,
      busy: row.order_id !== null,
      orderId: row.order_id,
      updatedAt: row.updated_at,
    })),
    orders: orders.map((row) => ({
      id: row.id,
      status: row.status,
      storeName: row.store_name,
      storeLat: row.store_lat,
      storeLng: row.store_lng,
      dropoffAddress: row.dropoff_address,
      dropoffLat: row.dropoff_lat,
      dropoffLng: row.dropoff_lng,
      conductorId: row.conductor_id,
    })),
  };
}

// Conductors heading to, or collecting from, this store. Customer addresses are never included.
export function vendorMap(ownerId: number): VendorMap {
  const store = sql.get<{ name: string; address: string; lat: number; lng: number }>(
    'SELECT name, address, lat, lng FROM stores WHERE owner_id = ?',
    ownerId,
  );
  if (!store) throw new HttpError(404, 'err.noStore');
  const conductors = sql.all<{
    id: number;
    name: string;
    vehicle: VehicleType;
    lat: number;
    lng: number;
    updated_at: string | null;
    order_id: number;
    status: OrderStatus;
  }>(
    `SELECT c.user_id AS id, u.name, c.vehicle, c.lat, c.lng, c.location_updated_at AS updated_at, o.id AS order_id, o.status
     FROM orders o
     JOIN stores s ON s.id = o.store_id
     JOIN conductors c ON c.user_id = o.conductor_id
     JOIN users u ON u.id = c.user_id
     WHERE s.owner_id = ? AND o.status IN (${sqlIn(DELIVERY_STATUSES)}) AND c.lat IS NOT NULL AND c.lng IS NOT NULL`,
    ownerId,
  );
  return {
    store: { name: store.name, address: store.address, lat: store.lat, lng: store.lng },
    conductors: conductors.map((row) => ({
      id: row.id,
      name: row.name,
      vehicle: row.vehicle,
      lat: row.lat,
      lng: row.lng,
      orderId: row.order_id,
      status: row.status,
      updatedAt: row.updated_at,
    })),
  };
}
