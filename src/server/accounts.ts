import { z } from 'zod';
import { hashPassword, verifyPassword, type AuthUser } from './auth';
import { getConductorProfile } from './conductors';
import { now, sql, tx, type Param } from './db';
import { HttpError } from './http';
import { notify } from './notifications';
import type { AdminSubscription, AdminUserRow, GpProfile, Me, PlanId, Role, Store, UserStatus } from '../shared/types';
import { PLANS, sellingUntilAfter, isSellingAt, daysLeftAt } from '../shared/plans';

const VEHICLES = ['moto', 'bicycle', 'car', 'van'] as const;
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

const common = {
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(6).max(128),
  phone: z.string().trim().max(30).optional(),
};

export const registerSchema = z.discriminatedUnion('role', [
  z.object({
    ...common,
    role: z.literal('buyer'),
    address: z.string().trim().max(200).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
  }),
  z.object({
    ...common,
    role: z.literal('vendor'),
    storeName: z.string().trim().min(2).max(100),
    storeAddress: z.string().trim().min(5).max(200),
    storeLat: latitude,
    storeLng: longitude,
    storePhone: z.string().trim().max(30).optional(),
    storeWebsite: z.string().trim().max(200).optional(),
    storeOpenTime: z.string().trim().max(10).optional(),
    storeCloseTime: z.string().trim().max(10).optional(),
    description: z.string().trim().max(500).optional(),
  }),
  z.object({
    ...common,
    role: z.literal('conductor'),
    vehicle: z.enum(VEHICLES).default('moto'),
    address: z.string().trim().max(200).optional(),
  }),
  z.object({
    ...common,
    role: z.literal('gp'),
    country: z.string().trim().min(2).max(80),
    internationalPhone: z.string().trim().min(5).max(30),
    senegalPhone: z.string().trim().min(5).max(30),
    dropoffAddress: z.string().trim().min(5).max(200),
    dropoffLat: latitude,
    dropoffLng: longitude,
  }),
]);

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(128),
});

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  lat: latitude.nullable().optional(),
  lng: longitude.nullable().optional(),
});

export const storeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  address: z.string().trim().min(5).max(200),
  lat: latitude,
  lng: longitude,
  phone: z.string().trim().max(30).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  bannerUrl: z.string().trim().max(500).nullable().optional(),
  openTime: z.string().trim().max(10).nullable().optional(),
  closeTime: z.string().trim().max(10).nullable().optional(),
});

interface UserRow {
  id: number;
  role: Role;
  status: UserStatus;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

const USER_SELECT = 'SELECT id, role, status, name, email, phone, address, lat, lng, created_at FROM users';

interface StoreRow {
  id: number;
  owner_id: number;
  name: string;
  description: string | null;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  banner_url: string | null;
  open_time: string | null;
  close_time: string | null;
  status: UserStatus;
}

const STORE_SELECT = `SELECT s.id, s.owner_id, s.name, s.description, s.address, s.lat, s.lng, s.phone, s.website, s.banner_url, s.open_time, s.close_time, u.status
  FROM stores s JOIN users u ON u.id = s.owner_id`;

function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    website: row.website,
    bannerUrl: row.banner_url,
    openTime: row.open_time,
    closeTime: row.close_time,
    status: row.status,
  };
}

export function findStoreByOwner(ownerId: number): Store | null {
  const row = sql.get<StoreRow>(`${STORE_SELECT} WHERE s.owner_id = ?`, ownerId);
  return row ? toStore(row) : null;
}

export function getGpProfile(userId: number): GpProfile | null {
  const row = sql.get<{
    country: string | null;
    international_phone: string | null;
    senegal_phone: string | null;
    dropoff_address: string | null;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
  }>('SELECT country, international_phone, senegal_phone, dropoff_address, dropoff_lat, dropoff_lng FROM gp_profiles WHERE user_id = ?', userId);
  if (!row) return null;
  return {
    userId,
    country: row.country,
    internationalPhone: row.international_phone,
    senegalPhone: row.senegal_phone,
    dropoffAddress: row.dropoff_address,
    dropoffLat: row.dropoff_lat,
    dropoffLng: row.dropoff_lng,
  };
}

export const gpProfileSchema = z.object({
  country: z.string().trim().min(2).max(80),
  internationalPhone: z.string().trim().min(5).max(30),
  senegalPhone: z.string().trim().min(5).max(30),
  dropoffAddress: z.string().trim().min(5).max(200),
  dropoffLat: latitude,
  dropoffLng: longitude,
});

export function updateGpProfile(ownerId: number, input: z.infer<typeof gpProfileSchema>): GpProfile {
  sql.run(
    `INSERT INTO gp_profiles (user_id, country, international_phone, senegal_phone, dropoff_address, dropoff_lat, dropoff_lng)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       country = excluded.country,
       international_phone = excluded.international_phone,
       senegal_phone = excluded.senegal_phone,
       dropoff_address = excluded.dropoff_address,
       dropoff_lat = excluded.dropoff_lat,
       dropoff_lng = excluded.dropoff_lng`,
    ownerId,
    input.country,
    input.internationalPhone,
    input.senegalPhone,
    input.dropoffAddress,
    input.dropoffLat,
    input.dropoffLng,
  );
  return getGpProfile(ownerId)!;
}

export function requireStore(ownerId: number): Store {
  const store = findStoreByOwner(ownerId);
  if (!store) throw new HttpError(404, 'err.noStore');
  return store;
}

export function registerAccount(input: RegisterInput): number {
  if (sql.get('SELECT id FROM users WHERE email = ?', input.email)) {
    throw new HttpError(409, 'err.emailTaken');
  }
  const status: UserStatus = input.role === 'buyer' ? 'active' : 'pending';
  const phone = input.phone || null;
  const timestamp = now();
  return tx(() => {
    const info = sql.run(
      `INSERT INTO users (role, status, name, email, phone, password_hash, address, lat, lng, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.role,
      status,
      input.name,
      input.email,
      phone,
      hashPassword(input.password),
      input.role === 'buyer' ? (input.address ?? null) : null,
      input.role === 'buyer' ? (input.lat ?? null) : null,
      input.role === 'buyer' ? (input.lng ?? null) : null,
      timestamp,
    );
    const userId = Number(info.lastInsertRowid);
    if (input.role === 'vendor') {
      sql.run(
        `INSERT INTO stores (owner_id, name, description, address, lat, lng, phone, website, open_time, close_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        input.storeName,
        input.description || null,
        input.storeAddress,
        input.storeLat,
        input.storeLng,
        input.storePhone || phone,
        input.storeWebsite || null,
        input.storeOpenTime || null,
        input.storeCloseTime || null,
        timestamp,
      );
    }
    if (input.role === 'conductor') {
      sql.run('INSERT INTO conductors (user_id, vehicle, address) VALUES (?, ?, ?)', userId, input.vehicle, input.address || null);
    }
    if (input.role === 'gp') {
      sql.run(
        `INSERT INTO gp_profiles (user_id, country, international_phone, senegal_phone, dropoff_address, dropoff_lat, dropoff_lng)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        userId,
        input.country,
        input.internationalPhone,
        input.senegalPhone,
        input.dropoffAddress,
        input.dropoffLat,
        input.dropoffLng,
      );
    }
    return userId;
  });
}

export function checkCredentials(email: string, password: string): number {
  const user = sql.get<{ id: number; password_hash: string; status: UserStatus }>(
    'SELECT id, password_hash, status FROM users WHERE email = ?',
    email.toLowerCase(),
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'err.badCredentials');
  }
  if (user.status === 'suspended') {
    throw new HttpError(403, 'err.suspendedLogin');
  }
  return user.id;
}

export function loadMe(userId: number): Me {
  const user = sql.get<UserRow>(`${USER_SELECT} WHERE id = ?`, userId);
  if (!user) throw new HttpError(404, 'err.accountNotFound');
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    lat: user.lat,
    lng: user.lng,
    createdAt: user.created_at,
    store: user.role === 'vendor' ? findStoreByOwner(userId) : null,
    conductor: user.role === 'conductor' ? getConductorProfile(userId) : null,
    gp: user.role === 'gp' ? getGpProfile(userId) : null,
  };
}

export function updateProfile(userId: number, patch: z.infer<typeof profileSchema>): Me {
  const current = sql.get<UserRow>(`${USER_SELECT} WHERE id = ?`, userId);
  if (!current) throw new HttpError(404, 'err.accountNotFound');
  sql.run(
    'UPDATE users SET name = ?, phone = ?, address = ?, lat = ?, lng = ? WHERE id = ?',
    patch.name ?? current.name,
    patch.phone === undefined ? current.phone : patch.phone || null,
    patch.address === undefined ? current.address : patch.address || null,
    patch.lat === undefined ? current.lat : patch.lat,
    patch.lng === undefined ? current.lng : patch.lng,
    userId,
  );
  return loadMe(userId);
}

export function updateStore(ownerId: number, input: z.infer<typeof storeSchema>): Store {
  sql.run(
    'UPDATE stores SET name = ?, description = ?, address = ?, lat = ?, lng = ?, phone = ?, website = ?, banner_url = ?, open_time = ?, close_time = ? WHERE owner_id = ?',
    input.name,
    input.description || null,
    input.address,
    input.lat,
    input.lng,
    input.phone || null,
    input.website === undefined ? null : (input.website || null),
    input.bannerUrl === undefined ? null : (input.bannerUrl || null),
    input.openTime === undefined ? null : (input.openTime || null),
    input.closeTime === undefined ? null : (input.closeTime || null),
    ownerId,
  );
  return requireStore(ownerId);
}

export function listUsers(filters: { role?: Role; status?: UserStatus; q?: string }): AdminUserRow[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.role) {
    where.push('u.role = ?');
    params.push(filters.role);
  }
  if (filters.status) {
    where.push('u.status = ?');
    params.push(filters.status);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    where.push('(u.name LIKE ? OR u.email LIKE ? OR s.name LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = sql.all<{
    id: number;
    role: Role;
    status: UserStatus;
    name: string;
    email: string;
    phone: string | null;
    created_at: string;
    store_name: string | null;
    vehicle: AdminUserRow['vehicle'];
    is_online: number | null;
    gp_country: string | null;
    gp_dropoff: string | null;
    gp_international_phone: string | null;
    gp_senegal_phone: string | null;
  }>(
    `SELECT u.id, u.role, u.status, u.name, u.email, u.phone, u.created_at,
       s.name AS store_name, c.vehicle, c.is_online,
       g.country AS gp_country, g.dropoff_address AS gp_dropoff,
       g.international_phone AS gp_international_phone, g.senegal_phone AS gp_senegal_phone
     FROM users u
     LEFT JOIN stores s ON s.owner_id = u.id
     LEFT JOIN conductors c ON c.user_id = u.id
     LEFT JOIN gp_profiles g ON g.user_id = u.id
     ${whereSql}
     ORDER BY u.created_at DESC
     LIMIT 300`,
    ...params,
  );
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    storeName: row.store_name,
    vehicle: row.vehicle,
    isOnline: row.is_online === null ? null : row.is_online === 1,
    gpCountry: row.gp_country,
    gpDropoff: row.gp_dropoff,
    gpInternationalPhone: row.gp_international_phone,
    gpSenegalPhone: row.gp_senegal_phone,
  }));
}

export function setUserStatus(actor: AuthUser, userId: number, status: 'active' | 'suspended'): { id: number; status: UserStatus } {
  if (actor.id === userId) throw new HttpError(400, 'err.ownStatus');
  const user = sql.get<{ id: number; role: Role; status: UserStatus }>('SELECT id, role, status FROM users WHERE id = ?', userId);
  if (!user) throw new HttpError(404, 'err.userNotFound');
  if (user.role === 'admin') throw new HttpError(400, 'err.adminLocked');
  sql.run('UPDATE users SET status = ? WHERE id = ?', status, userId);
  if (status === 'suspended') sql.run('UPDATE conductors SET is_online = 0 WHERE user_id = ?', userId);
  if (status === 'active' && user.role === 'vendor') {
    sql.run("UPDATE stores SET sells_until = datetime('now', '+30 days'), plan = COALESCE(plan, 'trial') WHERE owner_id = ? AND sells_until IS NULL", userId);
  }
  if (status !== user.status) {
    notify(
      [userId],
      status === 'active'
        ? { type: 'account.approved', titleKey: 'notif.approved.title', bodyKey: 'notif.approved.body' }
        : { type: 'account.suspended', titleKey: 'notif.suspended.title', bodyKey: 'notif.suspended.body' },
    );
  }
  return { id: userId, status };
}
export function listStoreSubscriptions(): AdminSubscription[] {
  const rows = sql.all<{ id: number; name: string; owner_name: string; plan: string; sells_until: string | null }>(
    `SELECT s.id, s.name, u.name AS owner_name, s.plan, s.sells_until
     FROM stores s JOIN users u ON u.id = s.owner_id ORDER BY s.name`,
  );
  return rows.map((row) => {
    const plan = (row.plan ?? 'trial') as PlanId;
    const details = PLANS[plan] ?? PLANS.trial;
    const productCount = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM offers WHERE store_id = ?', row.id)?.n ?? 0;
    return {
      storeId: row.id,
      storeName: row.name,
      ownerName: row.owner_name,
      plan,
      sellsUntil: row.sells_until,
      daysLeft: daysLeftAt(row.sells_until),
      selling: isSellingAt(row.sells_until),
      productCount,
      productLimit: details.productLimit,
    };
  });
}

export function activatePlan(storeId: number, plan: PlanId, months: number): { sellsUntil: string } {
  const store = sql.get<{ sells_until: string | null }>('SELECT sells_until FROM stores WHERE id = ?', storeId);
  if (!store) throw new HttpError(404, 'err.storeNotFound');
  const until = sellingUntilAfter(store.sells_until, months);
  const iso = until.toISOString();
  sql.run('UPDATE stores SET plan = ?, sells_until = ? WHERE id = ?', plan, iso, storeId);
  return { sellsUntil: iso };
}

export function pauseStoreNow(storeId: number): void {
  const store = sql.get<{ id: number }>('SELECT id FROM stores WHERE id = ?', storeId);
  if (!store) throw new HttpError(404, 'err.storeNotFound');
  sql.run("UPDATE stores SET sells_until = datetime('now', '-1 day') WHERE id = ?", storeId);
}
