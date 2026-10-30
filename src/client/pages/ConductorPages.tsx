import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { LocationInput } from '../components/LocationInput';
import { ConductorMap } from '../components/MapView';
import { DetailBlock, MapLink } from '../components/OrderParts';
import { formatDateTime, formatKm, timeAgo, vehicleLabel } from '../format';
import { distanceKm } from '../../shared/geo';
import { uploadImage } from '../api';
import { useAction, useApi } from '../hooks';
import { renderMessage, tr, useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Card, Empty, ErrorState, Loading, Notice, PageHeader, StatCard, StatusBadge } from '../ui';
import type { ConductorJob, ConductorOverview, OrderView, Point } from '../../shared/types';

export function ConductorHomePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { money } = useSettings();
  const action = useAction();
  const [tick, setTick] = useState(0);
  const overview = useApi(() => api<ConductorOverview>('/conductor/overview'), [tick]);
  const [sharing, setSharing] = useState(true);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [manual, setManual] = useState<Point | null>(null);
  const [address, setAddress] = useState<string>('');
  const approved = user?.status === 'active';
  const data = overview.data;
  const online = data?.profile.isOnline ?? false;
  useEffect(() => {
    if (data?.profile?.address !== undefined) setAddress(data.profile.address ?? '');
  }, [data?.profile?.address]);
  const own = data && data.profile.lat !== null && data.profile.lng !== null ? { lat: data.profile.lat, lng: data.profile.lng } : null;

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!online || !sharing || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        api('/conductor/location', { body: point })
          .then(() => setLastSent(new Date().toISOString()))
          .catch(() => undefined);
      },
      () => setGeoError(tr('conductor.locationDenied')),
      { enableHighAccuracy: true, maximumAge: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [online, sharing]);

  async function setStatus(next: boolean) {
    const result = await action.run(() => api('/conductor/status', { method: 'PUT', body: { isOnline: next } }));
    if (result !== undefined) overview.reload();
  }

  async function saveLocation() {
    if (!manual) return;
    const result = await action.run(() => api('/conductor/location', { body: manual }));
    if (result !== undefined) {
      setLastSent(new Date().toISOString());
      overview.reload();
    }
  }

  async function accept(orderId: number) {
    const result = await action.run(() => api(`/conductor/jobs/${orderId}/accept`, { method: 'POST' }));
    if (result !== undefined) overview.reload();
  }

  return (
    <div className="page">
      <PageHeader title={t('conductor.title')} subtitle={t('conductor.subtitle')} />
      {!approved && (
        <Notice tone="warn">{t('conductor.pending')}</Notice>
      )}
      {overview.loading && !data && <Loading />}
      {overview.error && !data && <ErrorState message={overview.error} />}

      {data && (
        <>
          <div className="stats">
            <StatCard
              label={t('common.status')}
              value={online ? t('conductor.online') : t('conductor.offline')}
              tone={online ? 'success' : 'neutral'}
              hint={vehicleLabel(data.profile.vehicle)}
            />
            <StatCard label={t('conductor.deliveredToday')} value={data.stats.deliveredToday} />
            <StatCard label={t('conductor.earnedToday')} value={money(data.stats.earningsTodayCents)} tone="success" />
            <StatCard
              label={t('conductor.totalEarned')}
              value={money(data.stats.earningsTotalCents)}
              hint={t('conductor.deliveryCount', { count: data.stats.deliveriesTotal })}
            />
          </div>

          <Card
            title={t('conductor.availability')}
            actions={
              <button
                className={online ? 'btn' : 'btn primary'}
                disabled={(!approved && !online) || action.busy || (online && !!data.active)}
                onClick={() => setStatus(!online)}
              >
                {online ? t('conductor.goOffline') : t('conductor.goOnline')}
              </button>
            }
          >
            <div className="row-gap wrap">
              <label className="checkbox">
                <input type="checkbox" checked={sharing} onChange={(event) => setSharing(event.target.checked)} />
                {t('conductor.shareLocation')}
              </label>
              {lastSent && <span className="muted small">{t('conductor.lastSent', { ago: timeAgo(lastSent) })}</span>}
              {data.profile.locationUpdatedAt && (
                <span className="muted small">{t('conductor.lastPosition', { date: formatDateTime(data.profile.locationUpdatedAt) })}</span>
              )}
            </div>
            {geoError && <Notice tone="warn">{geoError}</Notice>}
            <details className="manual-location" open>
              <summary>{t('conductor.manualLocation')}</summary>
              <div className="stack">
                <div className="row-gap">
                  <input
                    placeholder="Your address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn small"
                    disabled={action.busy || !address.trim()}
                    onClick={async () => {
                      // Geocode the address and move the pin on the map.
                      try {
                        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
                        const data = await res.json();
                        if (Array.isArray(data) && data.length > 0) {
                          const lat = parseFloat(data[0].lat);
                          const lng = parseFloat(data[0].lon);
                          setManual({ lat, lng });
                        }
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    Find on map
                  </button>
                </div>
                <LocationInput
                  value={manual ?? (data.profile.lat !== null && data.profile.lng !== null ? { lat: data.profile.lat, lng: data.profile.lng } : null)}
                  onChange={setManual}
                />
                <div>
                  <button
                    className="btn small"
                    onClick={async () => {
                      // Save both the address text and the map position together.
                      if (address.trim()) {
                        await action.run(() => api('/conductor/address', { method: 'PUT', body: { address } }));
                      }
                      await saveLocation();
                    }}
                    disabled={(!manual && !address.trim()) || action.busy}
                  >
                    {t('conductor.savePosition')}
                  </button>
                </div>
              </div>
            </details>
            {action.error && <ErrorState message={action.error} />}
          </Card>

          <Card title={t('map.routeAndJobs')}>
            <ConductorMap own={own} active={data.active} jobs={data.jobs} />
          </Card>

          {data.active ? (
            <ActiveDelivery order={data.active} onChanged={overview.reload} />
          ) : (
            <Empty title={t('conductor.noActive')}>{t('conductor.noActiveHint')}</Empty>
          )}

          <h3 className="section-title">{t('conductor.jobsNear')}</h3>
          {data.jobsNote && <Notice tone="info">{renderMessage(data.jobsNote, undefined, data.jobsNote)}</Notice>}
          {online && !data.active && data.jobs.length === 0 && (
            <Empty title={t('conductor.noJobs')}>{t('conductor.noJobsHint')}</Empty>
          )}
          <div className="grid-cards jobs">
            {data.jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                disabled={!approved || action.busy || !!data.active || !online}
                onAccept={accept}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ActiveDelivery({ order, onChanged }: { order: OrderView; onChanged: () => void }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const action = useAction();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  const ownLat = order.conductor?.lat ?? null;
  const ownLng = order.conductor?.lng ?? null;
  const nearPickup = ownLat !== null && ownLng !== null && distanceKm({ lat: ownLat, lng: ownLng }, { lat: order.store.lat, lng: order.store.lng }) <= 0.2;
  const nearDropoff = ownLat !== null && ownLng !== null && order.dropoff !== null && distanceKm({ lat: ownLat, lng: ownLng }, { lat: order.dropoff.lat, lng: order.dropoff.lng }) <= 0.2;

  async function step(path: string, body?: unknown) {
    const result = await action.run(() => api(path, { method: 'POST', body }));
    if (result !== undefined) onChanged();
  }

  async function onPhoto(file: File) {
    setUploading(true);
    try { setPhotoUrl(await uploadImage(file)); } catch { /* ignore */ }
    finally { setUploading(false); }
  }

  return (
    <Card title={t('conductor.activeTitle', { id: order.id })} actions={<StatusBadge status={order.status} />}>
      <div className="two-col tight">
        <DetailBlock title={t('conductor.step1')}>
          <strong>{order.store.name}</strong>
          <span className="muted">{order.store.address}</span>
          {order.store.phone && <span className="muted small">{order.store.phone}</span>}
          <MapLink lat={order.store.lat} lng={order.store.lng} />
        </DetailBlock>
        <DetailBlock title={t('conductor.step2')}>
          <strong>{order.dropoff?.name}</strong>
          <span className="muted">{order.dropoff?.address}</span>
          {order.dropoff?.phone && (
            <a className="link" href={`tel:${order.dropoff.phone}`}>
              {order.dropoff.phone}
            </a>
          )}
          {order.dropoff?.notes && <span className="muted small">{t('order.note', { note: order.dropoff.notes })}</span>}
          {order.dropoff && <MapLink lat={order.dropoff.lat} lng={order.dropoff.lng} />}
        </DetailBlock>
      </div>
      <div className="summary-row">
        <span>{t('conductor.items')}</span>
        <span>{itemCount}</span>
      </div>
      <div className="summary-row">
        <span>{order.paymentMethod === 'cash' && order.paymentStatus === 'due' ? t('conductor.collectCash') : t('conductor.payment')}</span>
        <span>
          {order.paymentMethod === 'cash' && order.paymentStatus === 'due' ? money(order.totalCents) : t('conductor.prepaid')}
        </span>
      </div>
      <div className="summary-row">
        <span>{t('conductor.yourEarning')}</span>
        <span className="price">{money(order.conductorEarningCents ?? 0)}</span>
      </div>
      {action.error && <ErrorState message={action.error} />}
      <div className="row-actions end">
        {order.status === 'preparing' && <span className="muted small">{t('conductor.storePreparing')}</span>}
        {order.status === 'ready' && (
          <>
            {!order.arrivedPickupAt && (
              <>
                {!nearPickup && <span className="muted small">Move to the store to mark arrived.</span>}
                <button className="btn" disabled={action.busy || !nearPickup} onClick={() => step(`/conductor/orders/${order.id}/arrive-pickup`)}>
                  Arrive at store
                </button>
              </>
            )}
            {order.arrivedPickupAt && <span className="muted small">Arrived at store.</span>}
            {!nearPickup && !order.arrivedPickupAt && <span className="muted small">Move to the store to confirm pickup.</span>}
            <button className="btn primary" disabled={action.busy || !nearPickup} onClick={() => step(`/conductor/orders/${order.id}/pickup`)}>
              {t('conductor.confirmPickup')}
            </button>
          </>
        )}
        {order.status === 'out_for_delivery' && (
          <>
            {!order.arrivedDropoffAt && (
              <>
                {!nearDropoff && <span className="muted small">Move to the drop-off to mark arrived.</span>}
                <button className="btn" disabled={action.busy || !nearDropoff} onClick={() => step(`/conductor/orders/${order.id}/arrive-dropoff`)}>
                  Arrive at drop-off
                </button>
              </>
            )}
            {order.arrivedDropoffAt && <span className="muted small">Arrived at drop-off.</span>}
            <div className="row-gap">
              <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
              {photoUrl && <img src={photoUrl} alt="proof" style={{ height: 48, borderRadius: 6 }} />}
            </div>
            {!nearDropoff && <span className="muted small">Move to the drop-off to confirm delivery.</span>}
            <button className="btn primary" disabled={action.busy || !nearDropoff || !photoUrl || uploading} onClick={() => step(`/conductor/orders/${order.id}/deliver`, { photoUrl })}>
              {t('conductor.confirmDelivered')}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function JobCard({ job, disabled, onAccept }: { job: ConductorJob; disabled: boolean; onAccept: (id: number) => void }) {
  const { t } = useI18n();
  const { money } = useSettings();
  return (
    <Card className="job-card">
      <div className="job-head">
        <div>
          <strong>{job.storeName}</strong>
          <div className="muted small">{job.pickupAddress}</div>
        </div>
        <div className="job-earn">{money(job.earningCents)}</div>
      </div>
      <div className="muted small">
        {t('conductor.toPickup', { km: formatKm(job.distanceToPickupKm) })} · {t('conductor.trip', { km: formatKm(job.tripKm) })} ·{' '}
        {t('conductor.jobItems', { count: job.itemCount })} · {t('conductor.aboutMinutes', { minutes: job.etaMinutes })}
      </div>
      <div className="muted small">{t('conductor.dropoffLine', { address: job.dropoffAddress })}</div>
      <div className="row-actions end">
        <span className="muted small">
          {job.status === 'ready' ? t('conductor.readyNow') : t('conductor.beingPrepared')} ·{' '}
          {t('conductor.posted', { ago: timeAgo(job.createdAt) })}
        </span>
        <button className="btn primary" disabled={disabled} onClick={() => onAccept(job.id)}>
          {t('conductor.acceptJob')}
        </button>
      </div>
    </Card>
  );
}

export function ConductorEarningsPage() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const overview = useApi(() => api<ConductorOverview>('/conductor/overview'));
  const history = useApi(() => api<{ orders: OrderView[] }>('/conductor/history').then((data) => data.orders));
  const filteredHistory = (history.data ?? []).filter((order) => {
    if (period === 'all') return true;
    const created = new Date(order.deliveredAt ?? order.createdAt).getTime();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (period === 'today') return now - created < day;
    if (period === 'week') return now - created < 7 * day;
    if (period === 'month') return now - created < 30 * day;
    return true;
  });

  return (
    <div className="page">
      <PageHeader title={t('conductor.earningsTitle')} subtitle={t('conductor.earningsSubtitle')} actions={<button className="btn small" onClick={() => window.print()}>Print report</button>} />
      <div className="toolbar">
        <select value={period} onChange={(e) => setPeriod(e.target.value as any)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
      </div>
      {overview.data && (
        <div className="stats">
          <StatCard label={t('conductor.earnedToday')} value={money(overview.data.stats.earningsTodayCents)} tone="success" />
          <StatCard label={t('conductor.totalEarned')} value={money(overview.data.stats.earningsTotalCents)} tone="success" />
          <StatCard label={t('conductor.deliveries')} value={overview.data.stats.deliveriesTotal} />
          <StatCard label={t('conductor.deliveredToday')} value={overview.data.stats.deliveredToday} />
        </div>
      )}
      <Card title={t('conductor.completed')}>
        {history.loading && !history.data && <Loading />}
        {history.error && <ErrorState message={history.error} />}
        {history.data?.length === 0 && <Empty title={t('conductor.noHistory')}>{t('conductor.noHistoryHint')}</Empty>}
        {filteredHistory.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('conductor.colDelivered')}</th>
                <th>{t('conductor.colOrder')}</th>
                <th>{t('conductor.colPickup')}</th>
                <th>{t('conductor.colArea')}</th>
                <th className="right">{t('conductor.colEarned')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map((order) => (
                <tr key={order.id}>
                  <td>{formatDateTime(order.deliveredAt)}</td>
                  <td>#{order.id}</td>
                  <td>{order.store.name}</td>
                  <td className="muted small">{order.dropoff?.address ?? '—'}</td>
                  <td className="right price">{money(order.conductorEarningCents ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
