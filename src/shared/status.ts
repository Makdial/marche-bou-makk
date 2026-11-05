import type { OrderStatus } from './types';

export const ORDER_STATUSES = [
  'placed',
  'preparing',
  'ready',
  'picked_up',
  'out_for_delivery',
  'delivered',
  'rejected',
  'cancelled',
] as const;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Waiting for store',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  picked_up: 'Picked up',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// Orders that are still in progress.
export const OPEN_STATUSES: OrderStatus[] = ['placed', 'preparing', 'ready', 'picked_up', 'out_for_delivery'];

// Orders a conductor can still claim.
export const JOB_STATUSES: OrderStatus[] = ['preparing', 'ready'];

// Orders that keep a conductor busy.
export const DELIVERY_STATUSES: OrderStatus[] = ['preparing', 'ready', 'picked_up', 'out_for_delivery'];

export const DELIVERY_STEPS: OrderStatus[] = ['placed', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'delivered'];
