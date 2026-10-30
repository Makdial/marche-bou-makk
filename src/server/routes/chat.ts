import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth';
import { listConversations, openConversation, openThread, searchContacts, sendMessage } from '../chat';
import { pushEvent } from '../notifications';
import { sql } from '../db';
import { HttpError, idParam } from '../http';

export const chatRouter = Router();

chatRouter.use(authenticate);

chatRouter.get('/conversations', (req, res) => {
  res.json(listConversations(req.user!));
});

chatRouter.post('/conversations', (req, res) => {
  const body = z.object({ userId: z.number().int().positive() }).parse(req.body ?? {});
  const result = openConversation(req.user!, body.userId);
  res.status(result.created ? 201 : 200).json({ conversation: result.conversation });
});

chatRouter.get('/conversations/:id', (req, res) => {
  res.json(openThread(req.user!, idParam(req.params.id)));
});

chatRouter.post('/conversations/:id/messages', (req, res) => {
  res.status(201).json({ message: sendMessage(req.user!, idParam(req.params.id), req.body ?? {}) });
});

chatRouter.get('/contacts', (req, res) => {
  const query = z.string().trim().catch('').parse(req.query.q);
  res.json({ contacts: searchContacts(req.user!, query) });
});

chatRouter.post('/conversations/:id/call', (req, res) => {
  const conversationId = idParam(req.params.id);
  const body = z.object({
    type: z.enum(['offer', 'answer', 'ice', 'hangup', 'ring']),
    payload: z.any().optional(),
  }).parse(req.body ?? {});
  const row = sql.get<{ user_a: number; user_b: number }>('SELECT user_a, user_b FROM conversations WHERE id = ?', conversationId);
  if (!row || (row.user_a !== req.user!.id && row.user_b !== req.user!.id)) {
    throw new HttpError(404, 'err.conversationNotFound');
  }
  const recipientId = row.user_a === req.user!.id ? row.user_b : row.user_a;
  pushEvent(recipientId, 'call', {
    conversationId,
    from: req.user!.id,
    fromName: req.user!.name,
    type: body.type,
    payload: body.payload ?? null,
  });
  res.json({ ok: true });
});