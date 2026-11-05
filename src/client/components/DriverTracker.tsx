import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { distanceKm } from '../../shared/geo';
import type { ConductorOverview, Point } from '../../shared/types';
import { Notice } from '../ui';

const SHARING_KEY = 'mbm.driverSharing';
const STATUS_EVENT = 'mbm-driver-status';
const SENT_EVENT = 'mbm-driver-sent';
// A new position is sent after moving 10 m, at most every 5 seconds. Otherwise the last one is repeated every 15 seconds.
const MOVE_KM = 0.01;
const MIN_GAP_MS = 5000;
const HEARTBEAT_MS = 15000;

// Whether the driver shares a live position. It is on unless the driver switches it off in this browser.
export function readSharing(): boolean {
  return localStorage.getItem(SHARING_KEY) !== '0';
}

export function writeSharing(on: boolean): void {
  localStorage.setItem(SHARING_KEY, on ? '1' : '0');
  announceDriverStatus();
}

// Asks the tracker to check the driver's status again, e.g. after going online or offline.
export function announceDriverStatus(): void {
  window.dispatchEvent(new Event(STATUS_EVENT));
}

// Calls back with the time of each position that reached the server. Returns a function that stops listening.
export function onLocationSent(listener: (at: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(SENT_EVENT, handler);
  return () => window.removeEventListener(SENT_EVENT, handler);
}

// Sends the driver's live position while they are online and sharing it. It is mounted in the app shell,
// so it keeps running while the driver reads messages or uses any other page.
export function DriverTracker() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isDriver = user?.role === 'conductor' && user.status === 'active';
  const [online, setOnline] = useState(false);
  const [sharing, setSharing] = useState(readSharing);
  const [problem, setProblem] = useState<'denied' | 'unavailable' | null>(null);

  useEffect(() => {
    if (!isDriver) return;
    let current = true;
    setOnline(false);
    const refresh = () => {
      setSharing(readSharing());
      api<ConductorOverview>('/conductor/overview')
        .then((data) => {
          if (current) setOnline(data.profile.isOnline);
        })
        .catch(() => undefined);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SHARING_KEY) setSharing(readSharing());
    };
    refresh();
    window.addEventListener(STATUS_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      current = false;
      window.removeEventListener(STATUS_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [isDriver]);

  useEffect(() => {
    setProblem(null);
    if (!isDriver || !online || !sharing || !navigator.geolocation) return;
    let last: { point: Point; at: number } | null = null;
    let latest: Point | null = null;
    let wakeLock: WakeLockSentinel | null = null;
    let stopped = false;

    const send = (point: Point) => {
      last = { point, at: Date.now() };
      api('/conductor/location', { body: point })
        .then(() => window.dispatchEvent(new CustomEvent(SENT_EVENT, { detail: new Date().toISOString() })))
        .catch(() => undefined);
    };

    const sendIfDue = () => {
      if (!latest) return;
      const elapsed = last ? Date.now() - last.at : Infinity;
      const moved = last ? distanceKm(last.point, latest) : Infinity;
      if (elapsed >= HEARTBEAT_MS || (elapsed >= MIN_GAP_MS && moved >= MOVE_KM)) send(latest);
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        latest = { lat: position.coords.latitude, lng: position.coords.longitude };
        setProblem(null);
        sendIfDue();
      },
      (error) => setProblem(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );

    const timer = window.setInterval(sendIfDue, 1000);

    // Keeps the screen awake while the driver is on the road. The browser drops the lock when the page is hidden.
    const keepAwake = () => {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (stopped) {
            sentinel.release().catch(() => undefined);
            return;
          }
          wakeLock = sentinel;
          sentinel.addEventListener('release', () => {
            wakeLock = null;
          });
        })
        .catch(() => undefined);
    };
    keepAwake();
    document.addEventListener('visibilitychange', keepAwake);

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', keepAwake);
      wakeLock?.release().catch(() => undefined);
    };
  }, [isDriver, online, sharing]);

  if (!isDriver || !online || !sharing || !problem) return null;
  return <Notice tone="warn">{t(problem === 'denied' ? 'conductor.locationDenied' : 'conductor.locationUnavailable')}</Notice>;
}
