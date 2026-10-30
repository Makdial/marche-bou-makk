import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useEffect, useState, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { api } from '../api';
import { vehicleLabel } from '../format';
import { useApi } from '../hooks';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Card, ErrorState } from '../ui';
import type { ConductorJob, OrderView, Point, VendorMap } from '../../shared/types';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ROUTING = 'https://router.project-osrm.org/route/v1/driving';
const FALLBACK_CENTER: Point = { lat: 14.6928, lng: -17.4467 };

type PinKind = 'store' | 'home' | 'conductor' | 'busy' | 'job';

export function pinIcon(kind: PinKind, glyph: string): L.DivIcon {
  return L.divIcon({
    className: `map-pin map-pin-${kind}`,
    html: `<span>${glyph}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });
}

function latLng(point: Point): [number, number] {
  return [point.lat, point.lng];
}

// Re-measures the map whenever its container changes size, e.g. when it opens inside a <details> element.
function KeepSized() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export function MapCanvas({
  children,
  center,
  zoom = 13,
  tall = false,
}: {
  children?: ReactNode;
  center?: Point | null;
  zoom?: number;
  tall?: boolean;
}) {
  const { settings } = useSettings();
  const start = center ?? settings?.center ?? FALLBACK_CENTER;
  return (
    <MapContainer className={tall ? 'map-canvas tall' : 'map-canvas'} center={latLng(start)} zoom={zoom} scrollWheelZoom={false}>
      <TileLayer url={TILES} attribution={ATTRIBUTION} />
      <KeepSized />
      {children}
    </MapContainer>
  );
}

// Fits the view to the given points whenever their positions change.
export function FitBounds({ points }: { points: Point[] }) {
  const map = useMap();
  const key = points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join('|');
  useEffect(() => {
    if (points.length === 1) map.setView(latLng(points[0]), 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points.map(latLng)), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({
    click: (event) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });
  return null;
}

// Pans the map when the picked point moves outside the visible area.
function FollowPoint({ point }: { point: Point | null }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    const target = L.latLng(point.lat, point.lng);
    if (!map.getBounds().contains(target)) map.setView(target, Math.max(map.getZoom(), 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.lat, point?.lng]);
  return null;
}

// Map for choosing a location: click the map or drag the pin.
export function LocationMap({ value, onChange }: { value: Point | null; onChange: (point: Point) => void }) {
  return (
    <MapCanvas center={value} zoom={value ? 15 : 12}>
      <ClickToPick onPick={onChange} />
      <FollowPoint point={value} />
      {value && (
        <Marker
          position={latLng(value)}
          draggable
          icon={pinIcon('home', '📍')}
          eventHandlers={{
            dragend: (event) => {
              const at = event.target.getLatLng();
              onChange({ lat: at.lat, lng: at.lng });
            },
          }}
        />
      )}
    </MapCanvas>
  );
}

// Road geometry between two points from the public OSRM router. Falls back to a straight line.
export function useRoadRoute(from: Point | null, to: Point | null): Point[] {
  const key = from && to ? `${from.lat},${from.lng};${to.lat},${to.lng}` : '';
  const [line, setLine] = useState<Point[]>([]);
  useEffect(() => {
    if (!from || !to) {
      setLine([]);
      return;
    }
    setLine([from, to]);
    const controller = new AbortController();
    fetch(`${ROUTING}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data: { routes?: { geometry: { coordinates: [number, number][] } }[] }) => {
        const coordinates = data.routes?.[0]?.geometry.coordinates;
        if (coordinates?.length) setLine(coordinates.map(([lng, lat]) => ({ lat, lng })));
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return line;
}

function RouteLine({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  return <Polyline positions={points.map(latLng)} pathOptions={{ color: '#0a9b57', weight: 4, opacity: 0.85 }} />;
}

// Store, drop-off and conductor for one order. Vendors and admins see the drop-off only if the view allows it.
export function OrderMap({ order }: { order: OrderView }) {
  const store: Point = { lat: order.store.lat, lng: order.store.lng };
  const dropoff: Point | null = order.dropoff ? { lat: order.dropoff.lat, lng: order.dropoff.lng } : null;
  const driver: Point | null =
    order.conductor && order.conductor.lat !== null && order.conductor.lng !== null
      ? { lat: order.conductor.lat, lng: order.conductor.lng }
      : null;
  const onTheWay = order.status === 'out_for_delivery';
  const to = onTheWay || !driver ? dropoff : store;
  const route = useRoadRoute(driver ?? store, to);
  const points = [store, dropoff, driver].filter((point): point is Point => point !== null);
  return (
    <MapCanvas>
      <FitBounds points={points} />
      <Marker position={latLng(store)} icon={pinIcon('store', '🏪')}>
        <Popup>{order.store.name}</Popup>
      </Marker>
      {dropoff && (
        <Marker position={latLng(dropoff)} icon={pinIcon('home', '🏠')}>
          <Popup>
            {order.dropoff?.name} · {order.dropoff?.address}
          </Popup>
        </Marker>
      )}
      {driver && (
        <Marker position={latLng(driver)} icon={pinIcon('conductor', '🛵')}>
          <Popup>{order.conductor?.name}</Popup>
        </Marker>
      )}
      <RouteLine points={route} />
    </MapCanvas>
  );
}

// The conductor's own position, the active delivery's route and the open jobs nearby.
export function ConductorMap({ own, active, jobs }: { own: Point | null; active: OrderView | null; jobs: ConductorJob[] }) {
  const { t } = useI18n();
  const store: Point | null = active ? { lat: active.store.lat, lng: active.store.lng } : null;
  const dropoff: Point | null = active?.dropoff ? { lat: active.dropoff.lat, lng: active.dropoff.lng } : null;
  const toward = active?.status === 'out_for_delivery' ? dropoff : store;
  const route = useRoadRoute(own ?? store, toward);
  const jobPoints = jobs.map((job) => ({ lat: job.pickupLat, lng: job.pickupLng }));
  const points = [own, store, dropoff, ...jobPoints].filter((point): point is Point => point !== null);
  return (
    <MapCanvas tall>
      <FitBounds points={points} />
      {own && (
        <Marker position={latLng(own)} icon={pinIcon('conductor', '🛵')}>
          <Popup>{t('map.youAreHere')}</Popup>
        </Marker>
      )}
      {store && (
        <Marker position={latLng(store)} icon={pinIcon('store', '🏪')}>
          <Popup>{active?.store.name}</Popup>
        </Marker>
      )}
      {dropoff && (
        <Marker position={latLng(dropoff)} icon={pinIcon('home', '🏠')}>
          <Popup>{active?.dropoff?.address}</Popup>
        </Marker>
      )}
      {!active &&
        jobs.map((job) => (
          <Marker key={job.id} position={[job.pickupLat, job.pickupLng]} icon={pinIcon('job', '📦')}>
            <Popup>
              {job.storeName} · {t('map.tripKm', { km: job.tripKm })}
            </Popup>
          </Marker>
        ))}
      <RouteLine points={route} />
    </MapCanvas>
  );
}

// The store and the conductors currently heading to it. Refreshes every 20 seconds.
export function VendorMapCard() {
  const { t } = useI18n();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 20000);
    return () => window.clearInterval(timer);
  }, []);
  const map = useApi(() => api<VendorMap>('/vendor/map'), [tick]);
  const data = map.data;
  const points = data
    ? [{ lat: data.store.lat, lng: data.store.lng }, ...data.conductors.map((conductor) => ({ lat: conductor.lat, lng: conductor.lng }))]
    : [];
  return (
    <Card title={t('map.yourStoreConductors')} actions={<button className="btn small" onClick={map.reload}>{t('common.refresh')}</button>}>
      {map.error && <ErrorState message={map.error} />}
      {data && (
        <MapCanvas>
          <FitBounds points={points} />
          <Marker position={[data.store.lat, data.store.lng]} icon={pinIcon('store', '🏪')}>
            <Popup>
              <strong>{data.store.name}</strong>
              <br />
              {data.store.address}
            </Popup>
          </Marker>
          {data.conductors.map((conductor) => (
            <Marker key={conductor.id} position={[conductor.lat, conductor.lng]} icon={pinIcon('conductor', '🛵')}>
              <Popup>
                <strong>{conductor.name}</strong>
                <br />
                {vehicleLabel(conductor.vehicle)} ·{' '}
                {conductor.status === 'ready'
                  ? t('map.waitingToCollect')
                  : conductor.status === 'out_for_delivery'
                    ? t('map.onWayToCustomer')
                    : t('map.headingToStore')}
              </Popup>
            </Marker>
          ))}
        </MapCanvas>
      )}
      {data && data.conductors.length === 0 && (
        <p className="muted small">{t('map.noConductorForStore')}</p>
      )}
    </Card>
  );
}
