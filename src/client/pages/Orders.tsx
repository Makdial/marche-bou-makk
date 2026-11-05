import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { OrderChat } from '../components/OrderChat';
import { OrderMap } from '../components/MapView';
import { DetailBlock, MapLink, OrderCard, OrderProgress } from '../components/OrderParts';
import { renderMessage, useI18n } from '../i18n';
import { Icon } from '../icons';
import { useAction, useApi } from '../hooks';
import { OPEN_STATUSES } from '../../shared/status';
import { formatDateTime, formatKm, paymentMethodLabel, paymentStatusLabel, statusLabel, timeAgo, vehicleLabel } from '../format';
import { useSettings } from '../settings';
import { Badge, Card, Empty, ErrorState, Loading, Notice, PageHeader, StatusBadge } from '../ui';
import type { OrderView, PackageStatus, PackageView } from '../../shared/types';
import type { TranslationKey } from '../../shared/i18n/en';

const PACKAGE_STEPS: { status: PackageStatus; key: TranslationKey }[] = [
  { status: 'registered', key: 'pkg.step.registered' },
  { status: 'picked_up', key: 'pkg.step.pickedUp' },
  { status: 'out_for_delivery', key: 'pkg.step.onTheWay' },
  { status: 'delivered', key: 'pkg.step.delivered' },
];

export function MyOrdersPage() {
  const { t } = useI18n();
  const location = useLocation();
  const placed = (location.state as { placed?: number } | null)?.placed;
  const orders = useApi(() => api<{ orders: OrderView[] }>('/orders').then((data) => data.orders));
  const packages = useApi(() => api<{ packages: PackageView[] }>('/packages').then((data) => data.packages));
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
      {packages.data && packages.data.length > 0 && (
        <>
          <h3 className="section-title">{t('pkg.title')}</h3>
          <p className="muted small">{t('pkg.subtitle')}</p>
          <div className="stack">
            {packages.data.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
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

function PackageCard({ pkg }: { pkg: PackageView }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const current = PACKAGE_STEPS.findIndex((step) => step.status === pkg.status);
  return (
    <Card className="order-row">
      <div className="order-card-head">
        <div>
          <strong>{t('pkg.from', { sender: pkg.senderName, gp: pkg.gp.name })}</strong>
          <span className="muted"> · {money(pkg.priceCents)}</span>
        </div>
        <Badge tone={pkg.status === 'delivered' ? 'success' : 'info'}>{t(PACKAGE_STEPS[current]?.key ?? 'pkg.step.registered')}</Badge>
      </div>
      <div className="package-steps">
        {PACKAGE_STEPS.map((step, index) => (
          <span key={step.status} className={index <= current ? 'done' : ''}>
            {t(step.key)}
          </span>
        ))}
      </div>
      <div className="muted small">
        {pkg.conductor && pkg.status !== 'delivered' && <div>{t('pkg.assigned', { name: pkg.conductor.name })}</div>}
        {pkg.status === 'picked_up' && !pkg.conductor && pkg.pickupAddress && (
          <div>
            {t('pkg.collectAt', { address: pkg.pickupAddress })} · {t('pkg.waitingPartner')}
          </div>
        )}
        {pkg.status !== 'delivered' && pkg.receiverAddress && <div>{t('pkg.deliverTo', { address: pkg.receiverAddress })}</div>}
      </div>
      {pkg.proofPhotoUrl && (
        <img src={pkg.proofPhotoUrl} alt={t('pkg.proof')} style={{ maxHeight: 120, borderRadius: 8, marginTop: 8 }} />
      )}
    </Card>
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

  const isStoreOwner = user?.role === 'vendor' && user.status === 'active' && user.store?.id === current.store.id;
  const cashToConfirm = isStoreOwner && current.status === 'delivered' && current.paymentMethod === 'cash' && !current.cashReceivedAt;
  const vendorPaymentNote: string | null =
    !isStoreOwner || current.status === 'rejected' || current.status === 'cancelled'
      ? null
      : current.paymentMethod === 'mobile_money'
        ? t('vendor.paidOnlineNote')
        : current.cashReceivedAt
          ? t('vendor.cashConfirmedAt', { date: formatDateTime(current.cashReceivedAt) })
          : current.status === 'delivered'
            ? null
            : t('vendor.cashOnDeliveryNote', { amount: money(current.totalCents) });

  // Buyers and stores talk to the driver on the order. The driver talks to the customer and to the store.
  const chats: { withUserId: number; title: string }[] = [];
  if (user?.status === 'active') {
    if ((user.role === 'buyer' || user.role === 'vendor') && current.conductor) {
      chats.push({ withUserId: current.conductor.id, title: t('order.chatWithDriver') });
    }
    if (user.role === 'conductor') {
      chats.push({ withUserId: current.buyer.id, title: t('order.chatWithCustomer') });
      chats.push({ withUserId: current.store.ownerId, title: t('order.chatWithStore') });
    }
  }
  const driverSeen = current.conductor?.locationUpdatedAt ?? null;
  const driverFresh = driverSeen !== null && Date.now() - new Date(driverSeen).getTime() < 90_000;

  async function vendorStep(path: string, body?: unknown) {
    const result = await action.run(() => api(path, { method: 'POST', body }));
    if (result !== undefined) order.reload();
  }

  async function declineOrder() {
    if (!current) return;
    const reason = window.prompt(t('vendor.declinePrompt'));
    if (reason === null) return;
    await vendorStep(`/vendor/orders/${current.id}/reject`, { reason: reason.trim() || undefined });
  }

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

      {isStoreOwner && (current.status === 'placed' || current.status === 'preparing' || current.status === 'ready' || cashToConfirm) && (
        <Card title={t('common.actions')}>
          {current.status === 'ready' && current.arrivedPickupAt && <p className="muted small">{t('vendor.driverArrived')}</p>}
          <div className="row-actions">
            {current.status === 'placed' && (
              <>
                <button className="btn primary" disabled={action.busy} onClick={() => vendorStep(`/vendor/orders/${current.id}/accept`)}>
                  {t('vendor.accept')}
                </button>
                <button className="btn danger" disabled={action.busy} onClick={declineOrder}>
                  {t('vendor.decline')}
                </button>
              </>
            )}
            {current.status === 'preparing' && (
              <button className="btn primary" disabled={action.busy} onClick={() => vendorStep(`/vendor/orders/${current.id}/ready`)}>
                {t('vendor.markReady')}
              </button>
            )}
            {current.status === 'ready' && current.conductor && (
              <button className="btn primary" disabled={action.busy} onClick={() => vendorStep(`/vendor/orders/${current.id}/picked-up`)}>
                {t('vendor.handedOver')}
              </button>
            )}
            {current.status === 'ready' && !current.conductor && <span className="muted small">{t('vendor.waitingCollect')}</span>}
            {cashToConfirm && (
              <>
                <span className="muted small">{t('vendor.cashToConfirm', { amount: money(current.totalCents) })}</span>
                <button className="btn primary" disabled={action.busy} onClick={() => vendorStep(`/vendor/orders/${current.id}/cash-received`)}>
                  {t('vendor.cashReceived')}
                </button>
              </>
            )}
          </div>
        </Card>
      )}

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
                <span className={`live ${driverFresh ? 'on' : ''}`}>
                  {driverSeen === null
                    ? t('order.driverNoPosition')
                    : driverFresh
                      ? t('order.driverLive', { ago: timeAgo(driverSeen) })
                      : t('order.driverStale', { ago: timeAgo(driverSeen) })}
                </span>
                {user?.role !== 'conductor' && (
                  <div className="row-actions">
                    {current.conductor.phone && (
                      <a className="btn small" href={`tel:${current.conductor.phone}`}>
                        <Icon name="phone" size={16} />
                        {t('order.callDriver')}
                      </a>
                    )}
                    {chats.length > 0 && (
                      <a className="btn small" href="#order-chat">
                        <Icon name="chat" size={16} />
                        {t('order.messageDriver')}
                      </a>
                    )}
                  </div>
                )}
              </DetailBlock>
            ) : (
              <p className="muted small">{t('order.noConductorYet')}</p>
            )}
            <span className="muted small">{t('order.distance', { km: formatKm(current.distanceKm) })}</span>
            {user?.role === 'vendor' && current.buyer && (
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
          {vendorPaymentNote && <p className="small">{vendorPaymentNote}</p>}

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

      {chats.length > 0 && (
        <div id="order-chat" className="stack">
          {chats.map((chat) => (
            <Card key={chat.withUserId} title={chat.title}>
              <OrderChat withUserId={chat.withUserId} />
            </Card>
          ))}
        </div>
      )}

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
