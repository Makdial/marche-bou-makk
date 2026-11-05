import { Router } from 'express';
import { authenticate, requireRole } from '../auth';
import { listReceiverPackages } from '../packages';

export const packagesRouter = Router();

packagesRouter.get('/', authenticate, requireRole('buyer'), (req, res) => {
  res.json({ packages: listReceiverPackages(req.user!) });
});
