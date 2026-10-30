import { useState } from 'react';
import { useI18n } from '../i18n';
import { LocationMap } from './MapView';
import type { Point } from '../../shared/types';
import type { TranslationKey } from '../../shared/i18n/en';

function round(value: number): number {
  return Math.round(value * 100000) / 100000;
}

interface Props {
  value: Point | null;
  onChange: (point: Point) => void;
}

export function LocationInput({ value, onChange }: Props) {
  const { t } = useI18n();
  const [latText, setLatText] = useState(value ? String(value.lat) : '');
  const [lngText, setLngText] = useState(value ? String(value.lng) : '');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  function edit(nextLat: string, nextLng: string) {
    setLatText(nextLat);
    setLngText(nextLng);
    const lat = Number(nextLat);
    const lng = Number(nextLng);
    if (nextLat.trim() && nextLng.trim() && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      onChange({ lat, lng });
    }
  }

  function pick(point: Point) {
    setLatText(String(point.lat));
    setLngText(String(point.lng));
    onChange(point);
  }

  function locate() {
    if (!navigator.geolocation) {
      setError('loc.unsupported');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        pick({ lat: round(position.coords.latitude), lng: round(position.coords.longitude) });
      },
      () => {
        setLocating(false);
        setError('loc.denied');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="location-input">
      <div className="row-gap">
        <input
          type="number"
          step="any"
          placeholder={t('loc.latitude')}
          value={latText}
          onChange={(event) => edit(event.target.value, lngText)}
        />
        <input
          type="number"
          step="any"
          placeholder={t('loc.longitude')}
          value={lngText}
          onChange={(event) => edit(latText, event.target.value)}
        />
        <button type="button" className="btn" onClick={locate} disabled={locating}>
          {locating ? t('loc.locating') : t('loc.useMyLocation')}
        </button>
      </div>
      <LocationMap value={value} onChange={pick} />
      <small className="muted">{t('loc.pickOnMap')}</small>
      {error && <small className="error-text">{t(error)}</small>}
    </div>
  );
}
