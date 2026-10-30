import { Router } from 'express';
import { z } from 'zod';
import { translate } from '../../shared/i18n';
import { authenticate, requireActive, requireRole } from '../auth';
import { conductorStats, getConductorProfile, jobBoard, setOnline, updateAddress, updateLocation } from '../conductors';
import { HttpError, idParam } from '../http';
import {
  activeDeliveryFor,
  conductorAccept,
  conductorArriveDropoff,
  conductorArrivePickup,
  conductorDeliver,
  conductorPickup,
  listConductorHistory,
} from '../orders';

export const conductorRouter = Router();

conductorRouter.use(authenticate, requireRole('conductor'));

conductorRouter.get('/overview', (req, res) => {
  const profile = getConductorProfile(req.user!.id);
  if (!profile) throw new HttpError(404, 'err.conductorProfile');
  const board = jobBoard(profile);
  res.json({
    profile,
    active: activeDeliveryFor(req.user!),
    jobs: board.jobs,
    jobsNote: board.note ? translate(req.locale, board.note) : null,
    stats: conductorStats(req.user!.id),
  });
});

conductorRouter.put('/status', requireActive, (req, res) => {
  const body = z.object({ isOnline: z.boolean() }).parse(req.body);
  res.json({ profile: setOnline(req.user!.id, body.isOnline) });
});

conductorRouter.post('/location', (req, res) => {
  const point = z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .parse(req.body);
  updateLocation(req.user!.id, point);
  res.json({ ok: true });
});

conductorRouter.put('/address', (req, res) => {
  const body = z.object({ address: z.string().trim().max(200) }).parse(req.body);
  updateAddress(req.user!.id, body.address);
  res.json({ ok: true });
});

conductorRouter.post('/jobs/:id/accept', requireActive, (req, res) => {
  res.json({ order: conductorAccept(req.user!, idParam(req.params.id)) });
});

conductorRouter.post('/orders/:id/arrive-pickup', requireActive, (req, res) => {
  res.json({ order: conductorArrivePickup(req.user!, idParam(req.params.id)) });
});

conductorRouter.post('/orders/:id/pickup', requireActive, (req, res) => {
  res.json({ order: conductorPickup(req.user!, idParam(req.params.id)) });
});

conductorRouter.post('/orders/:id/arrive-dropoff', requireActive, (req, res) => {
  res.json({ order: conductorArriveDropoff(req.user!, idParam(req.params.id)) });
});

conductorRouter.post('/orders/:id/deliver', requireActive, (req, res) => {
  const body = z.object({ photoUrl: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  res.json({ order: conductorDeliver(req.user!, idParam(req.params.id), body.photoUrl) });
});

conductorRouter.get('/history', (req, res) => {
  res.json({ orders: listConductorHistory(req.user!) });
});
