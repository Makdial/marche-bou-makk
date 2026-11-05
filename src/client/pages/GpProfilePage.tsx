import { Link, useParams } from 'react-router';
import { Marker } from 'react-leaflet';
import { api } from '../api';
import { MapCanvas, pinIcon } from '../components/MapView';
import { mapsUrl } from '../format';
import { useApi } from '../hooks';
import { useI18n } from '../i18n';
import { Card, ErrorState, Loading, PageHeader } from '../ui';
import type { PublicGpProfile } from '../../shared/types';

export function GpProfilePage() {
  const { id } = useParams();
  const { t } = useI18n();
  const gp = useApi(() => api<{ gp: PublicGpProfile }>(`/gps/${id}`).then((data) => data.gp), [id]);

  if (gp.loading && !gp.data) return <Loading />;
  if (gp.error && !gp.data) return <ErrorState message={gp.error} />;
  if (!gp.data) return null;
  const current = gp.data;

  return (
    <div className="page">
      <Link to="/shop" className="back">← {t('common.back')}</Link>
      <PageHeader title={current.name} subtitle={t('shop.gpDropoff')} />

      <div className="store-meta">
        {current.country && (
          <div className="store-meta-item">
            <span className="store-meta-label">{t('gp.countryResidence')}</span>
            <strong>{current.country}</strong>
          </div>
        )}
        {current.senegalPhone && (
          <div className="store-meta-item">
            <span className="store-meta-label">{t('gp.senegalPhone')}</span>
            <strong>{current.senegalPhone}</strong>
          </div>
        )}
        {current.address && (
          <div className="store-meta-item">
            <span className="store-meta-label">{t('gp.dropoffAddress')}</span>
            <strong>{current.address}</strong>
          </div>
        )}
      </div>

      <Card
        title={t('gp.dropoffLocation')}
        actions={
          <a className="btn small" href={mapsUrl(current.lat, current.lng)} target="_blank" rel="noreferrer">
            {t('order.openMaps')}
          </a>
        }
      >
        <MapCanvas center={{ lat: current.lat, lng: current.lng }} zoom={15}>
          <Marker position={[current.lat, current.lng]} icon={pinIcon('conductor', '🌍')} />
        </MapCanvas>
      </Card>
    </div>
  );
}
