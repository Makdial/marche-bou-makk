import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { authenticate, optionalAuth, requireRole } from '../auth';
import { config } from '../config';
import { getProductDetail, listCategories, listProducts, productQuerySchema, setWatch } from '../catalog';
import { HttpError, idParam } from '../http';
import { getPublicSettings } from '../settings';
import { publicGps, publicStores } from '../maps';
import { getStoreProfile } from '../catalog';

export const publicRouter = Router();

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

publicRouter.get('/settings', (_req, res) => {
  res.json({ settings: getPublicSettings() });
});

publicRouter.get('/map/stores', (_req, res) => {
  res.json({ stores: publicStores() });
});

publicRouter.get('/map/gp', (_req, res) => {
  res.json({ gps: publicGps() });
});

publicRouter.get('/stores/:id', (req, res) => {
  res.json({ store: getStoreProfile(idParam(req.params.id)) });
});

publicRouter.get('/categories', (_req, res) => {
  res.json({ categories: listCategories() });
});

publicRouter.get('/products', (req, res) => {
  res.json({ products: listProducts(productQuerySchema.parse(req.query)) });
});

publicRouter.get('/products/:id', optionalAuth, (req, res) => {
  res.json({ product: getProductDetail(idParam(req.params.id), req.user?.id ?? null) });
});

publicRouter.post('/products/:id/watch', authenticate, requireRole('buyer'), (req, res) => {
  res.json({ watching: setWatch(req.user!.id, idParam(req.params.id), true) });
});

publicRouter.delete('/products/:id/watch', authenticate, requireRole('buyer'), (req, res) => {
  res.json({ watching: setWatch(req.user!.id, idParam(req.params.id), false) });
});

publicRouter.post(
  '/uploads',
  authenticate,
  requireRole('vendor', 'admin'),
  express.raw({ type: ['image/*', 'video/*'], limit: '25mb' }),
  (req, res) => {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, 'err.uploadImage');
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const extension = IMAGE_EXTENSIONS[type];
    if (!extension) throw new HttpError(400, 'err.imageType');
    const fileName = `${crypto.randomUUID()}${extension}`;
    fs.writeFileSync(path.join(config.uploadsDir, fileName), body);
    res.status(201).json({ url: `/uploads/${fileName}` });
  },
);
