import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireActive, requireRole } from '../auth';
import { createOffer, listVendorOffers, offerCreateSchema, offerPatchSchema, updateOffer } from '../catalog';
import { idParam } from '../http';
import { listVendorOrders, vendorAccept, vendorCashReceived, vendorPickedUp, vendorReady, vendorReject } from '../orders';
import { requireStore, storeSchema, updateStore } from '../accounts';
import { getSettings } from '../settings';
import { vendorStats } from '../stats';
import { vendorMap } from '../maps';
import { vendorPlan } from '../catalog';
import { deleteOffer } from '../catalog';

export const vendorRouter = Router();

vendorRouter.use(authenticate, requireRole('vendor'));

vendorRouter.get('/overview', (req, res) => {
  res.json({ stats: vendorStats(requireStore(req.user!.id).id) });
});

vendorRouter.get('/map', (req, res) => {
  res.json(vendorMap(req.user!.id));
});

vendorRouter.get('/store', (req, res) => {
  res.json({ store: requireStore(req.user!.id) });
});

vendorRouter.put('/store', (req, res) => {
  res.json({ store: updateStore(req.user!.id, storeSchema.parse(req.body)) });
});

vendorRouter.get('/offers', (req, res) => {
  res.json({ offers: listVendorOffers(requireStore(req.user!.id).id) });
});

vendorRouter.post('/offers', requireActive, (req, res) => {
  const store = requireStore(req.user!.id);
  const result = createOffer(store, offerCreateSchema.parse(req.body));
  res.status(201).json(result);
});

vendorRouter.patch('/offers/:id', requireActive, (req, res) => {
  const store = requireStore(req.user!.id);
  const offer = updateOffer(
    store,
    idParam(req.params.id),
    offerPatchSchema.parse(req.body),
    getSettings().lowStockThreshold,
  );
  res.json({ offer });
});

vendorRouter.delete('/offers/:id', requireActive, (req, res) => {
  const store = requireStore(req.user!.id);
  deleteOffer(store, idParam(req.params.id));
  res.status(204).end();
});

vendorRouter.get('/plan', (req, res) => {
  const store = requireStore(req.user!.id);
  res.json({ plan: vendorPlan(store.id) });
});

vendorRouter.get('/orders', (req, res) => {
  const scope = z.enum(['open', 'done', 'all']).catch('open').parse(req.query.scope);
  res.json({ orders: listVendorOrders(req.user!, scope) });
});

vendorRouter.post('/orders/:id/accept', requireActive, (req, res) => {
  res.json({ order: vendorAccept(req.user!, idParam(req.params.id)) });
});

vendorRouter.post('/orders/:id/reject', requireActive, (req, res) => {
  const body = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body ?? {});
  res.json({ order: vendorReject(req.user!, idParam(req.params.id), body.reason) });
});

vendorRouter.post('/orders/:id/ready', requireActive, (req, res) => {
  res.json({ order: vendorReady(req.user!, idParam(req.params.id)) });
});

vendorRouter.post('/orders/:id/picked-up', requireActive, (req, res) => {
  res.json({ order: vendorPickedUp(req.user!, idParam(req.params.id)) });
});

vendorRouter.post('/orders/:id/cash-received', requireActive, (req, res) => {
  res.json({ order: vendorCashReceived(req.user!, idParam(req.params.id)) });
});
