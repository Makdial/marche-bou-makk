import { Fragment, useEffect, useState } from 'react';
import { Marker, Polyline, Popup } from 'react-leaflet';
import { api } from '../api';
import { FitBounds, MapCanvas, pinIcon } from '../components/MapView';
import { useApi } from '../hooks';
import { useI18n } from '../i18n';
import { Card, ErrorState, Loading, PageHeader } from '../ui';
import type { AdminMap as AdminMapData } from '../../shared/types';

const STORE_STATUS_KEY = {
  pending: 'admin.statusPending',
  active: 'admin.statusActive',
  suspended: 'admin.statusSuspended',
} as const;

// Every store, conductor and open order on one map. Refreshes every 15 seconds.
export function AdminMapPage() {
  const { t } = useI18n();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const map = useApi(() => api<AdminMapData>('/admin/map'), [tick]);
  const data = map.data;
  const points = data
    ? [
        ...data.stores.map((store) => ({ lat: store.lat, lng: store.lng })),
        ...data.conductors.map((conductor) => ({ lat: conductor.lat, lng: conductor.lng })),
        ...data.orders.flatMap((order) => [
          { lat: order.storeLat, lng: order.storeLng },
          { lat: order.dropoffLat, lng: order.dropoffLng },
        ]),
      ]
    : [];
  const online = data?.conductors.filter((conductor) => conductor.online).length ?? 0;
  const busy = data?.conductors.filter((conductor) => conductor.busy).length ?? 0;
  const setKey = data
    ? [...data.stores.map((store) => store.id), ...data.conductors.map((conductor) => conductor.id), ...data.orders.map((order) => order.id)].join(',')
    : '';

  return (
    <div className="page">
      <PageHeader
        title={t('map.liveTitle')}
        subtitle={t('map.liveSubtitle')}
        actions={
          <button className="btn" onClick={map.reload}>
            {t('common.refresh')}
          </button>
        }
      />
      <div className="legend">
        <span>🏪 {t('shop.storeCount', { count: data?.stores.length ?? 0 })}</span>
        <span>🛵 {t('map.legendConductors', { count: online })}</span>
        <span>{t('map.legendBusy', { count: busy })}</span>
        <span>📦 {t('map.legendOrders', { count: data?.orders.length ?? 0 })}</span>
      </div>
      {map.loading && !data && <Loading />}
      {map.error && <ErrorState message={map.error} />}
      {data && (
        <Card>
          <MapCanvas tall>
            <FitBounds points={points} fitKey={setKey} />
            {data.stores.map((store) => (
              <Marker
                key={`store-${store.id}`}
                position={[store.lat, store.lng]}
                icon={pinIcon('store', '🏪')}
                eventHandlers={{ click: () => window.location.assign(`/shop/stores/${store.id}`) }}
              >
                <Popup>
                  <strong>{store.name}</strong>
                  <br />
                  {store.address}
                  <br />
                  {t('map.storeStatus', { status: `@${STORE_STATUS_KEY[store.status]}` })}
                </Popup>
              </Marker>
            ))}
            {data.conductors.map((conductor) => (
              <Marker
                key={`conductor-${conductor.id}`}
                position={[conductor.lat, conductor.lng]}
                icon={pinIcon(conductor.busy ? 'busy' : 'conductor', '🛵')}
              >
                <Popup>
                  <strong>{conductor.name}</strong>
                  <br />
                  {t('map.conductorLine', {
                    vehicle: `@vehicle.${conductor.vehicle}`,
                    online: conductor.online ? '@admin.online' : '@admin.offline',
                    state: conductor.busy ? '@map.onDelivery' : '@map.free',
                  })}
                </Popup>
              </Marker>
            ))}
            {data.orders.map((order) => (
              <Fragment key={`order-${order.id}`}>
                <Polyline
                  positions={[
                    [order.storeLat, order.storeLng],
                    [order.dropoffLat, order.dropoffLng],
                  ]}
                  pathOptions={{ color: order.conductorId ? '#0a9b57' : '#8b5cf6', weight: 3, dashArray: '6 6' }}
                />
                {!order.conductorId && (
                  <Marker position={[order.storeLat, order.storeLng]} icon={pinIcon('job', '📦')}>
                    <Popup>
                      {t('map.orderNumber', { id: order.id })} · {order.storeName} · {t('map.waitingForConductor')}
                    </Popup>
                  </Marker>
                )}
                <Marker position={[order.dropoffLat, order.dropoffLng]} icon={pinIcon('home', '🏠')}>
                  <Popup>
                    {t('map.orderPopup', { id: order.id, status: `@status.${order.status}`, address: order.dropoffAddress })}
                  </Popup>
                </Marker>
              </Fragment>
            ))}
          </MapCanvas>
        </Card>
      )}
    </div>
  );
}
