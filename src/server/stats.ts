import { sql, sqlIn } from './db';
import { getSettings } from './settings';
import { DELIVERY_STATUSES, JOB_STATUSES, OPEN_STATUSES, ORDER_STATUSES } from '../shared/status';
import type { AdminStats, OrderStatus, Role, VendorStats } from '../shared/types';

export function vendorStats(storeId: number): VendorStats {
  const today = new Date().toISOString().slice(0, 10);
  const orders = sql.get<{ today: number; open: number; delivered: number; revenue: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN 1 ELSE 0 END), 0) AS today,
       COALESCE(SUM(CASE WHEN status IN (${sqlIn(OPEN_STATUSES)}) THEN 1 ELSE 0 END), 0) AS open,
       COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
       COALESCE(SUM(CASE WHEN status = 'delivered' THEN subtotal_cents - commission_cents ELSE 0 END), 0) AS revenue
     FROM orders WHERE store_id = ?`,
    today,
    storeId,
  );
  const offers = sql.get<{ products: number; low: number; sold_out: number }>(
    `SELECT COUNT(*) AS products,
       COALESCE(SUM(CASE WHEN stock > 0 AND stock <= ? THEN 1 ELSE 0 END), 0) AS low,
       COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS sold_out
     FROM offers WHERE store_id = ? AND is_active = 1`,
    getSettings().lowStockThreshold,
    storeId,
  );
  return {
    ordersToday: orders?.today ?? 0,
    openOrders: orders?.open ?? 0,
    deliveredTotal: orders?.delivered ?? 0,
    revenueCents: orders?.revenue ?? 0,
    productCount: offers?.products ?? 0,
    lowStockCount: offers?.low ?? 0,
    soldOutCount: offers?.sold_out ?? 0,
  };
}

export function adminStats(): AdminStats {
  const users: Record<Role, number> = { buyer: 0, vendor: 0, conductor: 0, admin: 0, gp: 0 };
  for (const row of sql.all<{ role: Role; n: number }>('SELECT role, COUNT(*) AS n FROM users GROUP BY role')) {
    users[row.role] = row.n;
  }
  const pending = (role: Role) =>
    sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = ? AND status = 'pending'", role)?.n ?? 0;

  const ordersByStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
  for (const row of sql.all<{ status: OrderStatus; n: number }>('SELECT status, COUNT(*) AS n FROM orders GROUP BY status')) {
    ordersByStatus[row.status] = row.n;
  }

  const delivered = sql.get<{ gmv: number; commission: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents), 0) AS gmv, COALESCE(SUM(commission_cents), 0) AS commission, COUNT(*) AS n
     FROM orders WHERE status = 'delivered'`,
  );
  const onlineConductors =
    sql.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM conductors c JOIN users u ON u.id = c.user_id
       WHERE c.is_online = 1 AND u.status = 'active'`,
    )?.n ?? 0;
  const openJobs =
    sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE conductor_id IS NULL AND status IN (${sqlIn(JOB_STATUSES)})`)?.n ?? 0;
  const activeDeliveries =
    sql.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM orders WHERE conductor_id IS NOT NULL AND status IN (${sqlIn(DELIVERY_STATUSES)})`,
    )?.n ?? 0;

  const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const series = sql.all<{ day: string; orders: number; total: number }>(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS total
     FROM orders
     WHERE substr(created_at, 1, 10) >= ? AND status NOT IN ('rejected', 'cancelled')
     GROUP BY day`,
    since,
  );
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(Date.now() - (6 - index) * 86_400_000).toISOString().slice(0, 10);
    const hit = series.find((row) => row.day === day);
    return { day, orders: hit?.orders ?? 0, totalCents: hit?.total ?? 0 };
  });

  return {
    users,
    pendingVendors: pending('vendor'),
    pendingConductors: pending('conductor'),
    ordersByStatus,
    gmvCents: delivered?.gmv ?? 0,
    commissionCents: delivered?.commission ?? 0,
    deliveredCount: delivered?.n ?? 0,
    onlineConductors,
    openJobs,
    activeDeliveries,
    lastSevenDays,
  };
}
