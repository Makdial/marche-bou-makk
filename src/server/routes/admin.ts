import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth';
import { listUsers, setUserStatus } from '../accounts';
import { alertSchema, listAlerts, sendAlert } from '../alerts';
import { adminAssign, autoDispatch, listAllOrders } from '../orders';
import { idParam } from '../http';
import { notify } from '../notifications';
import { sql } from '../db';
import { getSettings, settingsSchema, updateSettings } from '../settings';
import { adminStats } from '../stats';
import { ORDER_STATUSES } from '../../shared/status';
import { adminMap } from '../maps';
import { listStoreSubscriptions, activatePlan, pauseStoreNow } from '../accounts';
import { listCategories, createCategory, deleteCategory } from '../catalog';

export const adminRouter = Router();

adminRouter.use(authenticate, requireRole('admin'));

adminRouter.get('/map', (_req, res) => {
  res.json(adminMap());
});

adminRouter.get('/subscriptions', (_req, res) => {
  res.json({ subscriptions: listStoreSubscriptions() });
});

adminRouter.post('/stores/:id/plan', (req, res) => {
  const storeId = idParam(req.params.id);
  const body = z.object({ plan: z.enum(['starter', 'growth', 'pro']), months: z.number().int().min(1).max(12) }).parse(req.body);
  const result = activatePlan(storeId, body.plan, body.months);
  // notify vendor
  const store = sql.get<{ owner_id: number; name: string }>('SELECT owner_id, name FROM stores WHERE id = ?', storeId);
  if (store) {
    notify([store.owner_id], {
      type: 'subscription.updated',
      titleKey: 'notif.subscription.title',
      bodyKey: 'notif.subscription.body',
      params: { plan: body.plan, date: result.sellsUntil.slice(0, 10) },
    });
  }
  res.json(result);
});

adminRouter.post('/stores/:id/pause', (req, res) => {
  const storeId = idParam(req.params.id);
  pauseStoreNow(storeId);
  const store = sql.get<{ owner_id: number }>('SELECT owner_id FROM stores WHERE id = ?', storeId);
  if (store) {
    notify([store.owner_id], {
      type: 'store.paused',
      titleKey: 'notif.paused.title',
      bodyKey: 'notif.paused.body',
    });
  }
  res.json({ ok: true });
});

adminRouter.get('/categories', (_req, res) => {
  res.json({ categories: listCategories() });
});

adminRouter.post('/categories', (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
  const category = createCategory(body.name);
  res.status(201).json({ category });
});

adminRouter.delete('/categories/:id', (req, res) => {
  deleteCategory(idParam(req.params.id));
  res.status(204).end();
});

adminRouter.get('/stats', (_req, res) => {
  res.json({ stats: adminStats() });
});

adminRouter.get('/users', (req, res) => {
  const filters = z
    .object({
      role: z.enum(['buyer', 'vendor', 'conductor', 'admin', 'gp']).optional(),
      status: z.enum(['pending', 'active', 'suspended']).optional(),
      q: z.string().trim().max(100).optional(),
    })
    .parse(req.query);
  res.json({ users: listUsers(filters) });
});

adminRouter.patch('/users/:id', (req, res) => {
  const body = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
  res.json(setUserStatus(req.user!, idParam(req.params.id), body.status));
});

adminRouter.get('/orders', (req, res) => {
  const status = z.enum(ORDER_STATUSES).optional().parse(req.query.status);
  res.json({ orders: listAllOrders(status, req.user!) });
});

adminRouter.post('/orders/:id/assign', (req, res) => {
  const body = z.object({ conductorId: z.number().int().positive().nullable() }).parse(req.body);
  res.json({ order: adminAssign(req.user!, idParam(req.params.id), body.conductorId) });
});

adminRouter.post('/dispatch', (_req, res) => {
  res.json(autoDispatch());
});

adminRouter.get('/alerts', (_req, res) => {
  res.json({ alerts: listAlerts() });
});

adminRouter.post('/alerts', (req, res) => {
  res.status(201).json(sendAlert(req.user!, alertSchema.parse(req.body)));
});

adminRouter.get('/settings', (_req, res) => {
  res.json({ settings: getSettings() });
});

adminRouter.put('/settings', (req, res) => {
  res.json({ settings: updateSettings(settingsSchema.parse(req.body)) });
});
