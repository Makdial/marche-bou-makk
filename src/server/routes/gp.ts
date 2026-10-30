import { Router } from 'express';
import { authenticate, requireActive, requireRole } from '../auth';
import { getGpProfile, gpProfileSchema, updateGpProfile } from '../accounts';
import { HttpError } from '../http';
import { idParam } from '../http';
import { z } from 'zod';
import { createShipment, deleteShipment, listShipments, shipmentSchema, updateShipment, updateShipmentStatus } from '../gp_shipments';

export const gpRouter = Router();

gpRouter.use(authenticate, requireRole('gp'));

gpRouter.get('/profile', (req, res) => {
  res.json({ profile: getGpProfile(req.user!.id) });
});

gpRouter.put('/profile', requireActive, (req, res) => {
  res.json({ profile: updateGpProfile(req.user!.id, gpProfileSchema.parse(req.body)) });
});

gpRouter.get('/shipments', (req, res) => {
  res.json({ shipments: listShipments(req.user!.id) });
});

gpRouter.post('/shipments', requireActive, (req, res) => {
  const shipment = createShipment(req.user!.id, shipmentSchema.parse(req.body));
  res.status(201).json({ shipment });
});

gpRouter.patch('/shipments/:id', requireActive, (req, res) => {
  const body = z.object({ status: z.enum(['picked_up', 'delivered']), proofPhotoUrl: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  const shipment = updateShipmentStatus(req.user!.id, idParam(req.params.id), body.status, body.proofPhotoUrl);
  res.json({ shipment });
});

gpRouter.put('/shipments/:id', requireActive, (req, res) => {
  const shipment = updateShipment(req.user!.id, idParam(req.params.id), shipmentSchema.parse(req.body));
  res.json({ shipment });
});

gpRouter.delete('/shipments/:id', requireActive, (req, res) => {
  deleteShipment(req.user!.id, idParam(req.params.id));
  res.status(204).end();
});
