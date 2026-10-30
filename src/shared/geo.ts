import type { Point } from './types';

export function distanceKm(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

// Average city travel speed of about 20 km/h plus a small pickup buffer.
export function travelMinutes(km: number): number {
  return Math.round((km / 20) * 60) + 3;
}

// Travel time plus 15 minutes for the store to prepare the order.
export function estimateMinutes(km: number): number {
  return travelMinutes(km) + 15;
}
