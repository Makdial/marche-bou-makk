import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth';
import { listNotifications, markRead, openStream } from '../notifications';

export const notificationsRouter = Router();

notificationsRouter.get('/', authenticate, (req, res) => {
  const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(req.query.limit);
  res.json(listNotifications(req.user!.id, limit));
});

notificationsRouter.post('/read', authenticate, (req, res) => {
  const body = z.object({ ids: z.array(z.number().int().positive()).optional() }).parse(req.body ?? {});
  res.json({ unreadCount: markRead(req.user!.id, body.ids) });
});

notificationsRouter.get('/stream', authenticate, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: ready\ndata: {}\n\n');
  const close = openStream(req.user!.id, res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    close();
  });
});
