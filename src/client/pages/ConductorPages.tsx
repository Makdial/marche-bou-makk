import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { announceDriverStatus, onLocationSent, readSharing, writeSharing } from '../components/DriverTracker';
import { LocationInput } from '../components/LocationInput';
import { ConductorMap } from '../components/MapView';
import { DetailBlock, MapLink } from '../components/OrderParts';
import { formatDateTime, formatKm, timeAgo, vehicleLabel } from '../format';
import { distanceKm } from '../../shared/geo';
import { uploadImage } from '../api';
import { useAction, useApi } from '../hooks';
import { renderMessage, useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Badge, Card, Empty, ErrorState, Loading, Notice, PageHeader, StatCard, StatusBadge } from '../ui';
import type { ConductorJob, ConductorOverview, OrderView, PackageView, Point } from '../../shared/types';
import type { TranslationKey } from '../../shared/i18n/en';

const PACKAGE_STEP_KEY: Record<string, TranslationKey> = {
  registered: 'pkg.step.registered',
  picked_up: 'pkg.step.pickedUp',
  out_for_delivery: 'pkg.step.onTheWay',
  delivered: 'pkg.step.delivered',
};

export function ConductorHomePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { money } = useSettings();
  const action = useAction();
  const [tick, setTick] = useState(0);
  const overview = useApi(() => api<ConductorOverview>('/conductor/overview'), [tick]);
  const [sharing, setSharing] = useState(readSharing);
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

  useEffect(() => onLocationSent(setLastSent), []);

  async function setStatus(next: boolean) {
    const result = await action.run(() => api('/conductor/status', { method: 'PUT', body: { isOnline: next } }));
    if (result !== undefined) {
      overview.reload();
      announceDriverStatus();
    }
  }

  async function saveLocation() {
    if (!manual) return;
    const result = await action.run(() => api('/conductor/location', { body: manual }));
    if (result !== undefined) {
      setLastSent(new Date().toISOString());
      overview.reload();
    }
  }

  async function accept(job: ConductorJob) {
    const path = job.kind === 'package' ? `/conductor/packages/${job.id}/accept` : `/conductor/jobs/${job.id}/accept`;
    const result = await action.run(() => api(path, { method: 'POST' }));
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
                disabled={(!approved && !online) || action.busy || (online && (!!data.active || !!data.activePackage))}
                onClick={() => setStatus(!online)}
              >
                {online ? t('conductor.goOffline') : t('conductor.goOnline')}
              </button>
            }
          >
            <div className="row-gap wrap">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={sharing}
                  onChange={(event) => {
                    setSharing(event.target.checked);
                    writeSharing(event.target.checked);
                  }}
                />
                {t('conductor.shareLocation')}
              </label>
              {lastSent && <span className="muted small">{t('conductor.lastSent', { ago: timeAgo(lastSent) })}</span>}
              {data.profile.locationUpdatedAt && (
                <span className="muted small">{t('conductor.lastPosition', { date: formatDateTime(data.profile.locationUpdatedAt) })}</span>
              )}
            </div>
            <details className="manual-location" open>
              <summary>{t('conductor.manualLocation')}</summary>
              <div className="stack">
                <div className="row-gap">
                  <input
                    placeholder={t('conductor.yourAddress')}
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
                    {t('conductor.findOnMap')}
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
          ) : data.activePackage ? (
            <ActivePackage pkg={data.activePackage} own={own} onChanged={overview.reload} />
          ) : (
            <Empty title={t('conductor.noActive')}>{t('conductor.noActiveHint')}</Empty>
          )}

          <h3 className="section-title">{t('conductor.jobsNear')}</h3>
          {data.jobsNote && <Notice tone="info">{renderMessage(data.jobsNote, undefined, data.jobsNote)}</Notice>}
          {online && !data.active && !data.activePackage && data.jobs.length === 0 && (
            <Empty title={t('conductor.noJobs')}>{t('conductor.noJobsHint')}</Empty>
          )}
          <div className="grid-cards jobs">
            {data.jobs.map((job) => (
              <JobCard
                key={`${job.kind}-${job.id}`}
                job={job}
                disabled={!approved || action.busy || !!data.active || !!data.activePackage || !online}
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
                {!nearPickup && <span className="muted small">{t('conductor.moveToStoreArrive')}</span>}
                <button className="btn" disabled={action.busy || !nearPickup} onClick={() => step(`/conductor/orders/${order.id}/arrive-pickup`)}>
                  {t('conductor.arriveStore')}
                </button>
              </>
            )}
            {order.arrivedPickupAt && <span className="muted small">{t('conductor.arrivedStore')}</span>}
            {!nearPickup && !order.arrivedPickupAt && <span className="muted small">{t('conductor.moveToStorePickup')}</span>}
            <button className="btn primary" disabled={action.busy || !nearPickup} onClick={() => step(`/conductor/orders/${order.id}/pickup`)}>
              {t('conductor.confirmPickup')}
            </button>
          </>
        )}
        {order.status === 'picked_up' && (
          <>
            <span className="muted small">{t('conductor.pickedUpNote')}</span>
            <button className="btn primary" disabled={action.busy} onClick={() => step(`/conductor/orders/${order.id}/on-the-way`)}>
              {t('conductor.startTrip')}
            </button>
          </>
        )}
        {order.status === 'out_for_delivery' && (
          <>
            {!order.arrivedDropoffAt && (
              <>
                {!nearDropoff && <span className="muted small">{t('conductor.moveToDropoffArrive')}</span>}
                <button className="btn" disabled={action.busy || !nearDropoff} onClick={() => step(`/conductor/orders/${order.id}/arrive-dropoff`)}>
                  {t('conductor.arriveDropoff')}
                </button>
              </>
            )}
            {order.arrivedDropoffAt && <span className="muted small">{t('conductor.arrivedDropoff')}</span>}
            <div className="row-gap">
              <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
              {photoUrl && <img src={photoUrl} alt={t('conductor.proof')} style={{ height: 48, borderRadius: 6 }} />}
            </div>
            {!nearDropoff && <span className="muted small">{t('conductor.moveToDropoffDeliver')}</span>}
            <button className="btn primary" disabled={action.busy || !nearDropoff || !photoUrl || uploading} onClick={() => step(`/conductor/orders/${order.id}/deliver`, { photoUrl })}>
              {t('conductor.confirmDelivered')}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function ActivePackage({ pkg, own, onChanged }: { pkg: PackageView; own: Point | null; onChanged: () => void }) {
  const { t } = useI18n();
  const action = useAction();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const nearPickup =
    own !== null && pkg.pickupLat !== null && pkg.pickupLng !== null && distanceKm(own, { lat: pkg.pickupLat, lng: pkg.pickupLng }) <= 0.2;
  const nearReceiver =
    own !== null && pkg.receiverLat !== null && pkg.receiverLng !== null && distanceKm(own, { lat: pkg.receiverLat, lng: pkg.receiverLng }) <= 0.2;

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
    <Card title={t('conductor.activePackageTitle', { id: pkg.id })} actions={<Badge tone="info">{t(PACKAGE_STEP_KEY[pkg.status] ?? 'pkg.step.registered')}</Badge>}>
      <div className="two-col tight">
        <DetailBlock title={t('conductor.step1')}>
          <strong>{pkg.gp.name}</strong>
          <span className="muted">{pkg.pickupAddress}</span>
          {pkg.pickupLat !== null && pkg.pickupLng !== null && <MapLink lat={pkg.pickupLat} lng={pkg.pickupLng} />}
        </DetailBlock>
        <DetailBlock title={t('conductor.step2')}>
          <strong>{pkg.receiverName}</strong>
          <span className="muted">{pkg.receiverAddress}</span>
          {pkg.receiverPhone && (
            <a className="link" href={`tel:${pkg.receiverPhone}`}>
              {pkg.receiverPhone}
            </a>
          )}
          {pkg.receiverLat !== null && pkg.receiverLng !== null && <MapLink lat={pkg.receiverLat} lng={pkg.receiverLng} />}
        </DetailBlock>
      </div>
      <div className="summary-row">
        <span>{t('conductor.packageWeight')}</span>
        <span>{pkg.weightKg} kg</span>
      </div>
      {action.error && <ErrorState message={action.error} />}
      <div className="row-actions end">
        {pkg.status === 'picked_up' && (
          <>
            {!nearPickup && <span className="muted small">{t('conductor.movePackagePickup')}</span>}
            <button className="btn primary" disabled={action.busy || !nearPickup} onClick={() => step(`/conductor/packages/${pkg.id}/pickup`)}>
              {t('conductor.confirmPickup')}
            </button>
          </>
        )}
        {pkg.status === 'out_for_delivery' && (
          <>
            <div className="row-gap">
              <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
              {photoUrl && <img src={photoUrl} alt={t('conductor.proof')} style={{ height: 48, borderRadius: 6 }} />}
            </div>
            {!nearReceiver && <span className="muted small">{t('conductor.moveToDropoffDeliver')}</span>}
            <button className="btn primary" disabled={action.busy || !nearReceiver || !photoUrl || uploading} onClick={() => step(`/conductor/packages/${pkg.id}/deliver`, { photoUrl })}>
              {t('conductor.confirmDelivered')}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function JobCard({ job, disabled, onAccept }: { job: ConductorJob; disabled: boolean; onAccept: (job: ConductorJob) => void }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const isPackage = job.kind === 'package';
  return (
    <Card className="job-card">
      <div className="job-head">
        <div>
          <strong>{job.storeName}</strong>
          {isPackage && <div className="muted small">{t('conductor.packageJob')}</div>}
          <div className="muted small">{job.pickupAddress}</div>
        </div>
        {!isPackage && <div className="job-earn">{money(job.earningCents)}</div>}
      </div>
      <div className="muted small">
        {t('conductor.toPickup', { km: formatKm(job.distanceToPickupKm) })} · {t('conductor.trip', { km: formatKm(job.tripKm) })}
        {!isPackage && (
          <>
            {' '}· {t('conductor.jobItems', { count: job.itemCount })} · {t('conductor.aboutMinutes', { minutes: job.etaMinutes })}
          </>
        )}
      </div>
      <div className="muted small">{t('conductor.dropoffLine', { address: job.dropoffAddress })}</div>
      <div className="row-actions end">
        <span className="muted small">
          {isPackage ? t('conductor.packageReady') : job.status === 'ready' ? t('conductor.readyNow') : t('conductor.beingPrepared')} ·{' '}
          {t('conductor.posted', { ago: timeAgo(job.createdAt) })}
        </span>
        <button className="btn primary" disabled={disabled} onClick={() => onAccept(job)}>
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
      <PageHeader title={t('conductor.earningsTitle')} subtitle={t('conductor.earningsSubtitle')} actions={<button className="btn small" onClick={() => window.print()}>{t('common.printReport')}</button>} />
      <div className="toolbar">
        <select value={period} onChange={(e) => setPeriod(e.target.value as any)}>
          <option value="all">{t('common.period.all')}</option>
          <option value="today">{t('common.period.today')}</option>
          <option value="week">{t('common.period.week')}</option>
          <option value="month">{t('common.period.month')}</option>
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
