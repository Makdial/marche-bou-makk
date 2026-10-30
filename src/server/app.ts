import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { translate } from '../shared/i18n';
import { pickLocale, type Locale } from '../shared/locale';
import { config } from './config';
import { errorHandler } from './http';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { conductorRouter } from './routes/conductor';
import { gpRouter } from './routes/gp';
import { notificationsRouter } from './routes/notifications';
import { ordersRouter } from './routes/orders';
import { publicRouter } from './routes/public';
import { vendorRouter } from './routes/vendor';

declare global {
  namespace Express {
    interface Request {
      locale: Locale;
    }
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, _res, next) => {
    req.locale = pickLocale(req.header('x-locale'));
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d' }));
  app.use('/uploads', (req, res) => {
    res.status(404).json({ error: translate(req.locale, 'err.fileNotFound') });
  });

  app.use('/api', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/vendor', vendorRouter);
  app.use('/api/conductor', conductorRouter);
app.use('/api/gp', gpRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/notifications', notificationsRouter);
app.use('/api/messages', chatRouter);
  app.use('/api', (req, res) => {
    res.status(404).json({ error: translate(req.locale, 'err.routeNotFound') });
  });

  if (fs.existsSync(config.clientDir)) {
    app.use(express.static(config.clientDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(config.clientDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
