import { Router } from 'express';
import { authenticate, requireRole } from '../auth';
import { idParam } from '../http';
import {
  buildQuote,
  buyerCancel,
  checkout,
  checkoutSchema,
  getOrderFor,
  listBuyerOrders,
  quoteSchema,
} from '../orders';

export const ordersRouter = Router();

ordersRouter.post('/quote', authenticate, requireRole('buyer'), (req, res) => {
  const input = quoteSchema.parse(req.body);
  res.json({ quote: buildQuote(input.items, input.delivery) });
});

ordersRouter.post('/', authenticate, requireRole('buyer'), (req, res) => {
  const input = checkoutSchema.parse(req.body);
  res.status(201).json(checkout(req.user!, input));
});

ordersRouter.get('/', authenticate, requireRole('buyer'), (req, res) => {
  res.json({ orders: listBuyerOrders(req.user!) });
});

ordersRouter.get('/:id', authenticate, (req, res) => {
  res.json({ order: getOrderFor(idParam(req.params.id), req.user!) });
});

ordersRouter.post('/:id/cancel', authenticate, requireRole('buyer'), (req, res) => {
  res.json({ order: buyerCancel(req.user!, idParam(req.params.id)) });
});
