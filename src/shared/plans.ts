import type { PlanId } from './types';

export const PLAN_IDS = ['trial', 'starter', 'growth', 'pro'] as const;
export type { PlanId };

// Free period after approval. Trial stores get the Starter limits and pay the full transport fee.
export const TRIAL_DAYS = 30;
// Each paid month adds this many days of selling time.
export const MONTH_DAYS = 30;

export interface PlanDetails {
  id: PlanId;
  // Monthly price in minor units (FCFA x 100). The trial is free.
  priceCents: number;
  // Most product listings a store may have. null means no limit.
  productLimit: number | null;
  // Share of each delivery fee the store pays. The platform covers the rest.
  transportSharePercent: number;
}

export const PLANS: Record<PlanId, PlanDetails> = {
  trial: { id: 'trial', priceCents: 0, productLimit: 30, transportSharePercent: 100 },
  starter: { id: 'starter', priceCents: 15000 * 100, productLimit: 30, transportSharePercent: 100 },
  growth: { id: 'growth', priceCents: 30000 * 100, productLimit: 150, transportSharePercent: 80 },
  pro: { id: 'pro', priceCents: 50000 * 100, productLimit: null, transportSharePercent: 0 },
};

export const PURCHASABLE_PLANS: PlanDetails[] = [PLANS.starter, PLANS.growth, PLANS.pro];

// The part of a delivery fee charged to the store, in minor units.
export function storeTransportCents(transportFeeCents: number, plan: PlanId): number {
  return Math.round((transportFeeCents * PLANS[plan].transportSharePercent) / 100);
}

// A store can sell while its trial or paid period has not ended.
export function isSellingAt(sellsUntil: string | null, now: Date = new Date()): boolean {
  return sellsUntil !== null && new Date(sellsUntil).getTime() > now.getTime();
}

export function daysLeftAt(sellsUntil: string | null, now: Date = new Date()): number {
  if (!sellsUntil) return 0;
  return Math.max(0, Math.ceil((new Date(sellsUntil).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}

// Paid months stack: they start from the current end date when it is still in the future.
export function sellingUntilAfter(current: string | null, months: number, now: Date = new Date()): Date {
  const start = current && new Date(current).getTime() > now.getTime() ? new Date(current) : now;
  return new Date(start.getTime() + months * MONTH_DAYS * 24 * 60 * 60 * 1000);
}
