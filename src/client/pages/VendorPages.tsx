import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, uploadImage } from '../api';
import { useAuth } from '../auth';
import { LocationInput } from '../components/LocationInput';
import { VendorMapCard } from '../components/MapView';
import { categoryLabel, formatDateTime, vehicleLabel } from '../format';
import { moneyInput, moneyStep } from '../../shared/format';
import { useAction, useApi } from '../hooks';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Badge, Card, Empty, ErrorState, Field, Loading, Notice, PageHeader, ProductImage, StatCard, StatusBadge } from '../ui';
import type { TranslationKey } from '../../shared/i18n/en';
import type { Category, OrderView, Point, Store, VendorOffer, VendorStats } from '../../shared/types';

export function VendorOverviewPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { money } = useSettings();
  const stats = useApi(() => api<{ stats: VendorStats }>('/vendor/overview').then((data) => data.stats));
  const approved = user?.status === 'active';

  return (
    <div className="page">
      <PageHeader
        title={user?.store?.name ?? user?.name ?? t('vendor.yourStore')}
        subtitle={t('vendor.today', { date: new Date().toLocaleDateString() })}
        actions={
          <Link to="/vendor/orders" className="btn primary">
            {t('vendor.incomingOrders')}
          </Link>
        }
      />
      {!approved && <Notice tone="warn">{t('vendor.pending')}</Notice>}
      {stats.loading && !stats.data && <Loading />}
      {stats.error && <ErrorState message={stats.error} />}
      {stats.data && (
        <div className="stats">
          <StatCard label={t('vendor.stat.ordersToday')} value={stats.data.ordersToday} />
          <StatCard label={t('vendor.stat.open')} value={stats.data.openOrders} tone={stats.data.openOrders > 0 ? 'info' : 'neutral'} />
          <StatCard label={t('vendor.stat.delivered')} value={stats.data.deliveredTotal} tone="success" />
          <StatCard label={t('vendor.stat.revenue')} value={money(stats.data.revenueCents)} tone="success" />
          <StatCard label={t('vendor.stat.products')} value={stats.data.productCount} />
          <StatCard
            label={t('vendor.stat.lowStock')}
            value={stats.data.lowStockCount}
            tone={stats.data.lowStockCount > 0 ? 'warn' : 'neutral'}
          />
          <StatCard
            label={t('vendor.stat.soldOut')}
            value={stats.data.soldOutCount}
            tone={stats.data.soldOutCount > 0 ? 'danger' : 'neutral'}
          />
        </div>
      )}
      <VendorMapCard />
      <Card title={t('vendor.howTitle')}>
        <ol className="steps-list">
          <li>{t('vendor.howStep1')}</li>
          <li>{t('vendor.howStep2')}</li>
          <li>{t('vendor.howStep3')}</li>
        </ol>
      </Card>
    </div>
  );
}

type Scope = 'open' | 'done' | 'all';
const SCOPE_TABS: { value: Scope; label: TranslationKey }[] = [
  { value: 'open', label: 'vendor.tabIncoming' },
  { value: 'done', label: 'vendor.tabCompleted' },
  { value: 'all', label: 'vendor.tabAll' },
];

export function VendorOrdersPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { money } = useSettings();
  const action = useAction();
  const [scope, setScope] = useState<Scope>('open');
  const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [tick, setTick] = useState(0);
  const orders = useApi(() => api<{ orders: OrderView[] }>(`/vendor/orders?scope=${scope}`).then((data) => data.orders), [scope, tick]);
  const filteredOrders = (orders.data ?? []).filter((order) => {
    if (period === 'all') return true;
    const created = new Date(order.createdAt).getTime();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (period === 'today') return now - created < day;
    if (period === 'week') return now - created < 7 * day;
    if (period === 'month') return now - created < 30 * day;
    return true;
  });
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 10000);
    return () => window.clearInterval(timer);
  }, []);
  const approved = user?.status === 'active';

  async function act(path: string, body?: unknown) {
    const result = await action.run(() => api(path, { method: 'POST', body }));
    if (result !== undefined) orders.reload();
  }

  async function decline(orderId: number) {
    const reason = window.prompt(t('vendor.declinePrompt'));
    if (reason === null) return;
    await act(`/vendor/orders/${orderId}/reject`, { reason: reason.trim() || undefined });
  }

  return (
    <div className="page">
      <PageHeader title={t('vendor.ordersTitle')} subtitle={t('vendor.ordersSubtitle')} actions={<button className="btn small" onClick={() => window.print()}>Print report</button>} />
      <div className="tabs">
        {SCOPE_TABS.map((tab) => (
          <button key={tab.value} className={scope === tab.value ? 'tab active' : 'tab'} onClick={() => setScope(tab.value)}>
            {t(tab.label)}
          </button>
        ))}
      </div>
      {action.error && <ErrorState message={action.error} />}
      <div className="toolbar">
        <select value={period} onChange={(e) => setPeriod(e.target.value as any)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
      </div>
      {orders.loading && !orders.data && <Loading />}
      {orders.error && <ErrorState message={orders.error} />}
      {filteredOrders.length === 0 && <Empty title={t('vendor.nothingHere')}>{t('vendor.nothingHereHint')}</Empty>}

      <div className="stack">
        {filteredOrders.map((order) => (
          <Card key={order.id} className="order-row">
            <div className="order-card-head">
              <div>
                <strong>{t('order.title', { id: order.id })}</strong>
                <span className="muted">
                  {' '}
                  · {order.buyer.name} · {formatDateTime(order.createdAt)}
                </span>
              </div>
              <StatusBadge status={order.status} />
            </div>
            <ul className="item-list">
              {order.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.quantity} × {item.productName}
                  </span>
                  <span>{money(item.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            <div className="order-card-foot">
              <div className="muted small">
                {t('vendor.yourPayout')} <strong className="ink">{money(order.vendorPayoutCents ?? 0)}</strong>
                {' · '}
                {order.conductor
                  ? t('vendor.conductorInfo', { name: order.conductor.name, vehicle: vehicleLabel(order.conductor.vehicle) })
                  : t('vendor.noConductor')}
              </div>
              <div className="row-actions">
                {order.status === 'placed' && approved && (
                  <>
                    <button className="btn primary" disabled={action.busy} onClick={() => act(`/vendor/orders/${order.id}/accept`)}>
                      {t('vendor.accept')}
                    </button>
                    <button className="btn danger" disabled={action.busy} onClick={() => decline(order.id)}>
                      {t('vendor.decline')}
                    </button>
                  </>
                )}
                {order.status === 'preparing' && approved && (
                  <button className="btn primary" disabled={action.busy} onClick={() => act(`/vendor/orders/${order.id}/ready`)}>
                    {t('vendor.markReady')}
                  </button>
                )}
                {order.status === 'ready' && <span className="muted small">{t('vendor.waitingCollect')}</span>}
                {order.status === 'out_for_delivery' && <span className="muted small">{t('vendor.onTheWay')}</span>}
                <Link className="link" to={`/orders/${order.id}`}>
                  {t('common.details')}
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function VendorProductsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const approved = user?.status === 'active';
  const offers = useApi(() => api<{ offers: VendorOffer[] }>('/vendor/offers').then((data) => data.offers));
  const plan = useApi(() => api<{ plan: any }>('/vendor/plan').then((data) => data.plan));
  const categories = useApi(() => api<{ categories: Category[] }>('/categories').then((data) => data.categories));

  return (
    <div className="page">
      <PageHeader title={t('vendor.productsTitle')} subtitle={t('vendor.productsSubtitle')} />
      {plan.data && (
        <Notice tone={plan.data.selling ? 'info' : 'danger'}>
          {plan.data.productLimit === null
            ? t('plan.usageUnlimited', { used: plan.data.productCount })
            : t('plan.usage', { used: plan.data.productCount, limit: plan.data.productLimit })}
          {' · '}
          {plan.data.selling ? t('plan.sellingBadge') : t('plan.paused')}
        </Notice>
      )}
      {approved ? (
        <AddProductCard categories={categories.data ?? []} onAdded={offers.reload} />
      ) : (
        <Notice tone="warn">{t('vendor.canPublish')}</Notice>
      )}
      <Card title={`${t('vendor.listings')} (${offers.data?.length ?? 0})`}>
        {offers.loading && !offers.data && <Loading />}
        {offers.error && <ErrorState message={offers.error} />}
        {offers.data?.length === 0 && <Empty title={t('vendor.noProducts')}>{t('vendor.noProductsHint')}</Empty>}
        {offers.data && offers.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('vendor.colProduct')}</th>
                <th>{t('common.price')}</th>
                <th>{t('common.stock')}</th>
                <th>{t('vendor.colVisible')}</th>
                <th aria-label={t('common.save')} />
              </tr>
            </thead>
            <tbody>
              {offers.data.map((offer) => (
                <OfferRow key={offer.offerId} offer={offer} canEdit={approved} onSaved={offers.reload} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function OfferRow({ offer, canEdit, onSaved }: { offer: VendorOffer; canEdit: boolean; onSaved: () => void }) {
  const action = useAction();
  const { settings } = useSettings();
  const { t } = useI18n();
  const currency = settings?.currency ?? 'XOF';
  const [price, setPrice] = useState(moneyInput(offer.priceCents, currency));
  const [stock, setStock] = useState(String(offer.stock));
  const dirty = Math.round(Number(price) * 100) !== offer.priceCents || Number(stock) !== offer.stock;

  async function save(patch: Record<string, unknown>) {
    const result = await action.run(() => api(`/vendor/offers/${offer.offerId}`, { method: 'PATCH', body: patch }));
    if (result !== undefined) onSaved();
  }

  return (
    <tr>
      <td>
        <div className="product-cell">
          <ProductImage size="sm" name={offer.productName} url={offer.imageUrl} />
          <div>
            <strong>{offer.productName}</strong>
            <div className="muted small">
              {offer.categoryName ? categoryLabel(offer.categoryName) : t('shop.uncategorized')}
              {offer.otherSellers > 0 && ` · ${t('vendor.otherSellers', { count: offer.otherSellers })}`}
            </div>
          </div>
        </div>
      </td>
      <td>
        <input
          className="narrow"
          type="number"
          min={moneyStep(currency)}
          step={moneyStep(currency)}
          value={price}
          disabled={!canEdit}
          onChange={(event) => setPrice(event.target.value)}
        />
      </td>
      <td>
        <div className="row-gap">
          <input
            className="narrow"
            type="number"
            min="0"
            step="1"
            value={stock}
            disabled={!canEdit}
            onChange={(event) => setStock(event.target.value)}
          />
          {offer.stock === 0 && <Badge tone="danger">{t('vendor.soldOut')}</Badge>}
          {offer.stock > 0 && offer.stock <= 3 && <Badge tone="warn">{t('vendor.low')}</Badge>}
        </div>
      </td>
      <td>
        <label className="switch">
          <input
            type="checkbox"
            checked={offer.isActive}
            disabled={!canEdit}
            onChange={(event) => save({ isActive: event.target.checked })}
          />
          {offer.isActive ? t('vendor.on') : t('vendor.off')}
        </label>
      </td>
      <td className="right">
        {dirty && (
          <button
            className="btn small primary"
            disabled={action.busy}
            onClick={() => save({ priceCents: Math.round(Number(price) * 100), stock: Number(stock) })}
          >
            {t('common.save')}
          </button>
        )}
        {action.error && <small className="error-text">{action.error}</small>}
      </td>
    </tr>
  );
}

function AddProductCard({ categories, onAdded }: { categories: Category[]; onAdded: () => void }) {
  const { settings } = useSettings();
  const { t } = useI18n();
  const currency = settings?.currency ?? 'XOF';
  const action = useAction();
  const emptyForm = { name: '', categoryId: '', description: '', price: '', stock: '', isActive: true };
  const [form, setForm] = useState(emptyForm);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setImageUrl(await uploadImage(file));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('vendor.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const result = await action.run(() =>
      api<{ offer: VendorOffer; productCreated: boolean }>('/vendor/offers', {
        body: {
          name: form.name.trim(),
          categoryId: form.categoryId ? Number(form.categoryId) : null,
          description: form.description.trim() || undefined,
          imageUrl,
          priceCents: Math.round(Number(form.price) * 100),
          stock: Number(form.stock),
          isActive: form.isActive,
        },
      }),
    );
    if (result) {
      setMessage(result.productCreated ? t('vendor.published') : t('vendor.existingProduct'));
      setForm(emptyForm);
      setImageUrl(null);
      onAdded();
    }
  }

  return (
    <Card title={t('vendor.addProduct')}>
      <p className="muted small">{t('vendor.addProductHint')}</p>
      <form className="grid-form" onSubmit={submit}>
        <Field label={t('vendor.productName')}>
          <input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('common.category')}>
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">{t('vendor.choose')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryLabel(category.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('common.price')}>
          <input
            type="number"
            min={moneyStep(currency)}
            step={moneyStep(currency)}
            required
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </Field>
        <Field label={t('common.stock')}>
          <input
            type="number"
            min="0"
            step="1"
            required
            value={form.stock}
            onChange={(e) => setForm({ ...form, stock: e.target.value })}
          />
        </Field>
        <Field label={t('common.description')}>
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label={t('vendor.photo')}>
          <input type="file" accept="image/*" onChange={onFile} />
          {uploading && <small className="muted">{t('vendor.uploading')}</small>}
          {imageUrl && <img className="thumb" src={imageUrl} alt={t('vendor.productPreview')} />}
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          {t('vendor.showToShoppers')}
        </label>
        <div>
          <button className="btn primary" disabled={action.busy || uploading}>
            {action.busy ? t('vendor.publishing') : t('vendor.publish')}
          </button>
        </div>
      </form>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
    </Card>
  );
}

export function VendorStorePage() {
  const store = useApi(() => api<{ store: Store }>('/vendor/store').then((data) => data.store));
  if (store.loading && !store.data) return <Loading />;
  if (store.error && !store.data) return <ErrorState message={store.error} />;
  if (!store.data) return null;
  return <StoreForm key={store.data.id} store={store.data} onSaved={store.reload} />;
}

function StoreForm({ store, onSaved }: { store: Store; onSaved: () => void }) {
  const action = useAction();
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: store.name,
    description: store.description ?? '',
    address: store.address,
    phone: store.phone ?? '',
  });
  const [website, setWebsite] = useState<string>(store.website ?? '');
  const [openTime, setOpenTime] = useState<string>(store.openTime ?? '');
  const [closeTime, setCloseTime] = useState<string>(store.closeTime ?? '');
  const [bannerUrl, setBannerUrl] = useState<string | null>(store.bannerUrl ?? null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [point, setPoint] = useState<Point>({ lat: store.lat, lng: store.lng });
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const result = await action.run(() =>
      api('/vendor/store', {
        method: 'PUT',
        body: {
          name: form.name.trim(),
          description: form.description.trim() || null,
          address: form.address.trim(),
          phone: form.phone.trim() || null,
          website: website.trim() || null,
          bannerUrl,
          openTime: openTime.trim() || null,
          closeTime: closeTime.trim() || null,
          lat: point.lat,
          lng: point.lng,
        },
      }),
    );
    if (result !== undefined) {
      setSaved(true);
      onSaved();
    }
  }

  return (
    <div className="page">
      <PageHeader
        title={t('vendor.storeTitle')}
        subtitle={t('vendor.storeSubtitle')}
        actions={
          <Badge tone={store.status === 'active' ? 'success' : store.status === 'pending' ? 'warn' : 'danger'}>
            {store.status === 'active' ? t('vendor.approved') : store.status === 'pending' ? t('vendor.awaiting') : t('vendor.suspended')}
          </Badge>
        }
      />
      <Card>
        <form className="stack" onSubmit={submit}>
          <div className="grid-2">
            <Field label={t('vendor.storeName')}>
              <input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('common.phone')}>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Website">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." />
            </Field>
            <Field label="Opening time">
              <input value={openTime} onChange={(e) => setOpenTime(e.target.value)} placeholder="08:00" />
            </Field>
            <Field label="Closing time">
              <input value={closeTime} onChange={(e) => setCloseTime(e.target.value)} placeholder="22:00" />
            </Field>
          </div>
          <Field label={t('common.address')}>
            <input required minLength={5} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label={t('vendor.pickupLocation')} hint={t('vendor.pickupHint')}>
            <LocationInput value={point} onChange={setPoint} />
          </Field>
          <Field label={t('common.description')}>
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label={t('vendor.banner')} hint={t('vendor.bannerHint')}>
            {bannerUrl && <img className="store-banner-preview" src={bannerUrl} alt="banner" />}
            <div className="row-gap">
              <input type="file" accept="image/*" disabled={bannerUploading} onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBannerUploading(true);
                try { setBannerUrl(await uploadImage(file)); } catch (err) { /* ignore */ }
                finally { setBannerUploading(false); }
              }} />
              {bannerUrl && <button type="button" className="btn small" onClick={() => setBannerUrl(null)}>{t('vendor.bannerRemove')}</button>}
            </div>
          </Field>
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          {saved && <Notice tone="success">{t('vendor.storeSaved')}</Notice>}
          <div>
            <button className="btn primary" disabled={action.busy}>
              {action.busy ? t('common.saving') : t('vendor.saveStore')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
