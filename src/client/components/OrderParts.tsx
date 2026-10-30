import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { DELIVERY_STEPS } from '../../shared/status';
import type { OrderStatus, OrderView } from '../../shared/types';
import { formatDateTime, mapsUrl, paymentMethodLabel, statusLabel } from '../format';
import { Notice, StatusBadge } from '../ui';

export function OrderCard({ order, to }: { order: OrderView; to: string }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <Link to={to} className="order-card">
      <div className="order-card-head">
        <div>
          <strong>{t('order.title', { id: order.id })}</strong>
          <span className="muted"> · {order.store.name}</span>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="muted small">
        {t('common.itemCount', { count: itemCount })} · {formatDateTime(order.createdAt)}
        {order.etaMinutes !== null && <> · {t('order.aboutMinutes', { minutes: order.etaMinutes })}</>}
      </div>
      <div className="order-card-foot">
        <span className="price">{money(order.totalCents)}</span>
        <span className="muted small">{paymentMethodLabel(order.paymentMethod)}</span>
      </div>
    </Link>
  );
}

export function OrderProgress({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  if (status === 'rejected' || status === 'cancelled') {
    return <Notice tone="danger">{t('order.closed', { status: statusLabel(status) })}</Notice>;
  }
  const current = DELIVERY_STEPS.indexOf(status);
  return (
    <ol className="progress">
      {DELIVERY_STEPS.map((step, index) => (
        <li key={step} className={index < current ? 'done' : index === current ? 'current' : ''}>
          <span className="dot" />
          <span>{statusLabel(step)}</span>
        </li>
      ))}
    </ol>
  );
}

export function MapLink({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  const { t } = useI18n();
  return (
    <a className="link" href={mapsUrl(lat, lng)} target="_blank" rel="noreferrer">
      {label ?? t('order.openMaps')} ↗
    </a>
  );
}

export function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="detail-block">
      <span className="eyebrow">{title}</span>
      {children}
    </div>
  );
}
