import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { OrderMap } from '../components/MapView';
import { DetailBlock, MapLink, OrderCard, OrderProgress } from '../components/OrderParts';
import { renderMessage, useI18n } from '../i18n';
import { useAction, useApi } from '../hooks';
import { OPEN_STATUSES } from '../../shared/status';
import { formatDateTime, formatKm, paymentMethodLabel, paymentStatusLabel, statusLabel, vehicleLabel } from '../format';
import { useSettings } from '../settings';
import { Card, Empty, ErrorState, Loading, Notice, PageHeader, StatusBadge } from '../ui';
import type { OrderView } from '../../shared/types';

export function MyOrdersPage() {
  const { t } = useI18n();
  const location = useLocation();
  const placed = (location.state as { placed?: number } | null)?.placed;
  const orders = useApi(() => api<{ orders: OrderView[] }>('/orders').then((data) => data.orders));
  const open = orders.data?.filter((order) => OPEN_STATUSES.includes(order.status)) ?? [];
  const past = orders.data?.filter((order) => !OPEN_STATUSES.includes(order.status)) ?? [];

  return (
    <div className="page">
      <PageHeader
        title={t('orders.title')}
        subtitle={t('orders.subtitle')}
        actions={
          <Link to="/shop" className="btn">
            {t('orders.keepShopping')}
          </Link>
        }
      />
      {placed !== undefined && (
        <Notice tone="success">{t('orders.placedBanner', { count: placed })}</Notice>
      )}
      {orders.loading && !orders.data && <Loading />}
      {orders.error && <ErrorState message={orders.error} />}
      {orders.data && orders.data.length === 0 && (
        <Empty title={t('orders.empty')}>{t('orders.emptyHint')}</Empty>
      )}

      {open.length > 0 && (
        <>
          <h3 className="section-title">{t('orders.inProgress')}</h3>
          <div className="stack">
            {open.map((order) => (
              <OrderCard key={order.id} order={order} to={`/orders/${order.id}`} />
            ))}
          </div>
        </>
      )}
      {past.length > 0 && (
        <>
          <h3 className="section-title">{t('orders.past')}</h3>
          <div className="stack">
            {past.map((order) => (
              <OrderCard key={order.id} order={order} to={`/orders/${order.id}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function OrderPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { money } = useSettings();
  const { t } = useI18n();
  const action = useAction();
  const [tick, setTick] = useState(0);
  const order = useApi(() => api<{ order: OrderView }>(`/orders/${id}`).then((data) => data.order), [id, tick]);
  const live = order.data ? OPEN_STATUSES.includes(order.data.status) : false;

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, [live]);

  if (order.loading && !order.data) return <Loading />;
  if (order.error && !order.data) return <ErrorState message={order.error} />;
  const current = order.data;
  if (!current) return null;

  const backTo =
    user?.role === 'vendor'
      ? '/vendor/orders'
      : user?.role === 'conductor'
        ? '/conductor'
        : user?.role === 'admin'
          ? '/admin/orders'
          : '/orders';

  async function cancel() {
    if (!current) return;
    if (!window.confirm(t('order.cancelConfirm'))) return;
    const result = await action.run(() => api(`/orders/${current.id}/cancel`, { method: 'POST' }));
    if (result !== undefined) order.reload();
  }

  return (
    <div className="page">
      <Link to={backTo} className="back">
        ← {t('common.back')}
      </Link>
      <PageHeader
        title={t('order.title', { id: current.id })}
        subtitle={t('order.placedOn', { store: current.store.name, date: formatDateTime(current.createdAt) })}
        actions={
          <>
            <StatusBadge status={current.status} />
            <button className="btn small" onClick={() => window.print()}>
              {t('order.printTicket')}
            </button>
          </>
        }
      />

      <Card>
        <OrderProgress status={current.status} />
        {current.etaMinutes !== null && (
          <p className="eta">{t('order.eta', { minutes: current.etaMinutes })}</p>
        )}
      </Card>

      <Card title={t('map.title')}>
        <OrderMap order={current} />
      </Card>

      {action.error && <Notice tone="danger">{action.error}</Notice>}

      <div className="two-col">
        <Card title={t('common.delivery')}>
          <div className="stack">
            <DetailBlock title={t('order.pickup')}>
              <strong>{current.store.name}</strong>
              <span className="muted">{current.store.address}</span>
              {current.store.phone && <span className="muted small">{current.store.phone}</span>}
              <MapLink lat={current.store.lat} lng={current.store.lng} />
            </DetailBlock>

            {current.dropoff ? (
              <DetailBlock title={t('order.dropoff')}>
                <strong>{current.dropoff.name}</strong>
                <span className="muted">{current.dropoff.address}</span>
                {current.dropoff.phone && <span className="muted small">{current.dropoff.phone}</span>}
                {current.dropoff.notes && <span className="muted small">{t('order.note', { note: current.dropoff.notes })}</span>}
                <MapLink lat={current.dropoff.lat} lng={current.dropoff.lng} />
              </DetailBlock>
            ) : (
              <p className="muted small">{t('order.privateContact')}</p>
            )}

            {current.conductor ? (
              <DetailBlock title={t('order.conductorBlock')}>
                <strong>{current.conductor.name}</strong>
                <span className="muted small">
                  {vehicleLabel(current.conductor.vehicle)}
                  {current.conductor.phone && ` · ${current.conductor.phone}`}
                </span>
                {current.conductor.locationUpdatedAt && (
                  <span className="muted small">
                    {t('order.locationShared', { date: formatDateTime(current.conductor.locationUpdatedAt) })}
                  </span>
                )}
              </DetailBlock>
            ) : (
              <p className="muted small">{t('order.noConductorYet')}</p>
            )}
            <span className="muted small">{t('order.distance', { km: formatKm(current.distanceKm) })}</span>
            {user?.role === 'buyer' && current.conductor && (
              <Link to={`/messages?with=${current.conductor.id}`} className="link">
                {t('chat.messageConductor')}
              </Link>
            )}
            {(user?.role === 'conductor' || user?.role === 'vendor') && current.buyer && user.id !== current.buyer.id && (
              <Link to={`/messages?with=${current.buyer.id}`} className="link">
                {t('chat.messageCustomer')}
              </Link>
            )}
          </div>
        </Card>

        <Card title={t('cart.summary')}>
          <table className="table compact">
            <tbody>
              {current.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.quantity} × {item.productName}
                  </td>
                  <td className="right">{money(item.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="summary-row">
            <span>{t('common.subtotal')}</span>
            <span>{money(current.subtotalCents)}</span>
          </div>
          {user?.role === 'buyer' ? (
            <div className="summary-row">
              <span>{t('order.deliveryFee')}</span>
              <span>{t('order.deliveryIncluded')}</span>
            </div>
          ) : (
            <div className="summary-row">
              <span>{t('order.deliveryFee')}</span>
              <span>{money(current.transportFeeCents)}</span>
            </div>
          )}
          {user?.role === 'vendor' && (
            <p className="small">
              {t('vendor.transportCharge', { amount: money(current.storeTransportCents) })}
            </p>
          )}
          <div className="summary-row total">
            <span>{t('common.total')}</span>
            <span>{money(current.totalCents)}</span>
          </div>
          <p className="muted small">
            {t('order.paymentLine', {
              method: paymentMethodLabel(current.paymentMethod),
              status: paymentStatusLabel(current.paymentStatus),
            })}
          </p>

          {current.commissionCents !== null && (
            <p className="small">
              {t('order.commission', {
                commission: money(current.commissionCents),
                payout: money(current.vendorPayoutCents ?? 0),
              })}
            </p>
          )}
          {current.commissionCents === null && current.vendorPayoutCents !== null && (
            <p className="small">{t('order.payout', { amount: money(current.vendorPayoutCents) })}</p>
          )}
          {current.conductorEarningCents !== null && (
            <p className="small">{t('order.earning', { amount: money(current.conductorEarningCents) })}</p>
          )}

          {user?.role === 'buyer' && current.status === 'placed' && (
            <button className="btn danger block" disabled={action.busy} onClick={cancel}>
              {t('order.cancel')}
            </button>
          )}
        </Card>
      </div>

      {current.deliveryPhotoUrl && (
        <Card title={t('order.deliveryProof')}>
          <img src={current.deliveryPhotoUrl} alt={t('order.deliveryProof')} style={{ maxWidth: '100%', borderRadius: 8 }} />
        </Card>
      )}

      <Card title={t('order.activity')}>
        <ol className="timeline">
          {current.events.map((event, index) => (
            <li key={`${event.createdAt}-${index}`}>
              <strong>{statusLabel(event.status)}</strong>
              <span>{renderMessage(event.messageKey, event.params, event.message)}</span>
              <small className="muted">{formatDateTime(event.createdAt)}</small>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
