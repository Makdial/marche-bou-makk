import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { formatDateTime, roleLabel, statusLabel, vehicleLabel } from '../format';
import { useI18n } from '../i18n';
import { currencyLabel, moneyInput, moneyStep } from '../../shared/format';
import { useAction, useApi, useDebounced } from '../hooks';
import { useSettings } from '../settings';
import { ORDER_STATUSES } from '../../shared/status';
import {
  Badge,
  Card,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  StatCard,
  StatusBadge,
} from '../ui';
import type { TranslationKey } from '../../shared/i18n/en';
import type {
  AdminStats,
  AdminUserRow,
  AlertAudience,
  AlertItem,
  OrderView,
  ProductSummary,
  Settings,
  UserStatus,
} from '../../shared/types';

const USER_STATUS_KEY: Record<UserStatus, TranslationKey> = {
  active: 'admin.statusActive',
  pending: 'admin.statusPending',
  suspended: 'admin.statusSuspended',
};

export function AdminOverviewPage() {
  const { money } = useSettings();
  const { t } = useI18n();
  const stats = useApi(() => api<{ stats: AdminStats }>('/admin/stats').then((data) => data.stats));
  if (stats.loading && !stats.data) return <Loading />;
  if (stats.error && !stats.data) return <ErrorState message={stats.error} />;
  const s = stats.data;
  if (!s) return null;

  const totalUsers = s.users.buyer + s.users.vendor + s.users.conductor + s.users.admin;
  const pending = s.pendingVendors + s.pendingConductors;
  const maxOrders = Math.max(1, ...s.lastSevenDays.map((day) => day.orders));
  const totalOrders = Object.values(s.ordersByStatus).reduce((sum, count) => sum + count, 0);

  return (
    <div className="page">
      <PageHeader
        title={t('admin.overviewTitle')}
        subtitle={t('admin.overviewSubtitle')}
        actions={
          <Link to="/admin/alerts" className="btn primary">
            {t('admin.sendAlert')}
          </Link>
        }
      />
      <div className="stats">
        <StatCard label={t('admin.gmv')} value={money(s.gmvCents)} tone="success" hint={t('admin.deliveredCount', { count: s.deliveredCount })} />
        <StatCard label={t('admin.commission')} value={money(s.commissionCents)} tone="success" />
        <StatCard label={t('admin.openJobs')} value={s.openJobs} tone={s.openJobs > 0 ? 'warn' : 'neutral'} hint={t('admin.openJobsHint')} />
        <StatCard label={t('admin.activeDeliveries')} value={s.activeDeliveries} tone="info" />
        <StatCard label={t('admin.conductorsOnline')} value={s.onlineConductors} />
        <StatCard
          label={t('admin.pendingApprovals')}
          value={pending}
          tone={pending > 0 ? 'warn' : 'neutral'}
          hint={t('admin.pendingHint', { stores: s.pendingVendors, conductors: s.pendingConductors })}
        />
        <StatCard
          label={t('admin.usersCard')}
          value={totalUsers}
          hint={t('admin.usersHint', { buyers: s.users.buyer, vendors: s.users.vendor, conductors: s.users.conductor })}
        />
      </div>

      <div className="two-col">
        <Card title={t('admin.last7')}>
          <div className="bars">
            {s.lastSevenDays.map((day) => (
              <div key={day.day} className="bar-col">
                <span className="bar-value">{day.orders}</span>
                <div className="bar" style={{ height: `${(day.orders / maxOrders) * 100}%` }} />
                <span className="bar-label">{day.day.slice(5)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t('admin.byStatus')}>
          {ORDER_STATUSES.map((status) => {
            const count = s.ordersByStatus[status];
            return (
              <div key={status} className="status-row">
                <span>{statusLabel(status)}</span>
                <div className="meter">
                  <div style={{ width: `${totalOrders ? (count / totalOrders) * 100 : 0}%` }} />
                </div>
                <strong>{count}</strong>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

const ACCOUNT_STATUS_LABEL: Record<UserStatus, TranslationKey> = {
  active: 'admin.statusActive',
  pending: 'admin.statusPending',
  suspended: 'admin.statusSuspended',
};

export function AdminPeoplePage() {
  const action = useAction();
  const { t } = useI18n();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const debouncedQuery = useDebounced(query, 300);
  const users = useApi(
    () => {
      const params = new URLSearchParams();
      if (role) params.set('role', role);
      if (status) params.set('status', status);
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
      return api<{ users: AdminUserRow[] }>(`/admin/users?${params}`).then((data) => data.users);
    },
    [role, status, debouncedQuery],
  );

  async function setUserStatus(userId: number, next: 'active' | 'suspended') {
    const result = await action.run(() => api(`/admin/users/${userId}`, { method: 'PATCH', body: { status: next } }));
    if (result !== undefined) users.reload();
  }

  return (
    <div className="page">
      <PageHeader title={t('admin.peopleTitle')} subtitle={t('admin.peopleSubtitle')} />
      <div className="toolbar">
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">{t('admin.allRoles')}</option>
          <option value="vendor">{t('admin.roleStores')}</option>
          <option value="conductor">{t('admin.roleConductors')}</option>
          <option value="buyer">{t('admin.roleShoppers')}</option>
          <option value="gp">{t('role.gp')}</option>
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t('admin.anyStatus')}</option>
          <option value="pending">{t('admin.statusPending')}</option>
          <option value="active">{t('admin.statusActive')}</option>
          <option value="suspended">{t('admin.statusSuspended')}</option>
        </select>
        <input className="grow" placeholder={t('admin.searchPeople')} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {action.error && <ErrorState message={action.error} />}
      {users.loading && !users.data && <Loading />}
      {users.error && <ErrorState message={users.error} />}
      {users.data?.length === 0 && <Empty title={t('admin.noAccounts')} />}
      {users.data && users.data.length > 0 && (
        <Card>
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('admin.colRole')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.details')}</th>
                <th>{t('admin.joined')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {users.data.map((person) => (
                <tr key={person.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(person)}>
                  <td>
                    <strong>{person.name}</strong>
                    <div className="muted small">{person.email}</div>
                  </td>
                  <td>{roleLabel(person.role)}</td>
                  <td>
                    <Badge tone={person.status === 'active' ? 'success' : person.status === 'pending' ? 'warn' : 'danger'}>
                      {t(ACCOUNT_STATUS_LABEL[person.status])}
                    </Badge>
                  </td>
                  <td className="small">
                    {person.storeName ?? (person.vehicle ? (person.isOnline ? t('admin.optionOnline', { name: vehicleLabel(person.vehicle) }) : vehicleLabel(person.vehicle)) : '—')}
                  </td>
                  <td className="small muted">{formatDateTime(person.createdAt)}</td>
                  <td className="right">
                    {person.role !== 'admin' &&
                      (person.status === 'active' ? (
                        <button className="btn small danger" disabled={action.busy} onClick={() => setUserStatus(person.id, 'suspended')}>
                          {t('admin.suspend')}
                        </button>
                      ) : (
                        <button className="btn small primary" disabled={action.busy} onClick={() => setUserStatus(person.id, 'active')}>
                          {person.status === 'pending' ? t('admin.approve') : t('admin.reactivate')}
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {selected && (
        <Card title={t('admin.personDetails')}>
          <div className="store-meta">
            <div className="store-meta-item"><span className="store-meta-label">{t('common.name')}</span><strong>{selected.name}</strong></div>
            <div className="store-meta-item"><span className="store-meta-label">{t('common.email')}</span><strong>{selected.email}</strong></div>
            <div className="store-meta-item"><span className="store-meta-label">{t('admin.colRole')}</span><strong>{roleLabel(selected.role)}</strong></div>
            <div className="store-meta-item"><span className="store-meta-label">{t('common.status')}</span><strong>{t(USER_STATUS_KEY[selected.status])}</strong></div>
            {selected.phone && <div className="store-meta-item"><span className="store-meta-label">{t('common.phone')}</span><strong>{selected.phone}</strong></div>}
            {selected.storeName && <div className="store-meta-item"><span className="store-meta-label">{t('common.store')}</span><strong>{selected.storeName}</strong></div>}
            {selected.vehicle && <div className="store-meta-item"><span className="store-meta-label">{t('auth.vehicle')}</span><strong>{vehicleLabel(selected.vehicle)}</strong></div>}
            {selected.isOnline !== null && <div className="store-meta-item"><span className="store-meta-label">{t('conductor.online')}</span><strong>{selected.isOnline ? t('common.yes') : t('common.no')}</strong></div>}
            {selected.gpCountry && <div className="store-meta-item"><span className="store-meta-label">{t('admin.countryGp')}</span><strong>{selected.gpCountry}</strong></div>}
            {selected.gpInternationalPhone && <div className="store-meta-item"><span className="store-meta-label">{t('admin.intlPhone')}</span><strong>{selected.gpInternationalPhone}</strong></div>}
            {selected.gpSenegalPhone && <div className="store-meta-item"><span className="store-meta-label">{t('admin.senegalPhone')}</span><strong>{selected.gpSenegalPhone}</strong></div>}
            {selected.gpDropoff && <div className="store-meta-item"><span className="store-meta-label">{t('admin.dropoffSenegal')}</span><strong>{selected.gpDropoff}</strong></div>}
          </div>
          <button className="btn small" onClick={() => setSelected(null)}>{t('common.close')}</button>
        </Card>
      )}
    </div>
  );
}

export function AdminOrdersPage() {
  const { money } = useSettings();
  const { t } = useI18n();
  const action = useAction();
  const [status, setStatus] = useState('');
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const orders = useApi(
    () => api<{ orders: OrderView[] }>(`/admin/orders${status ? `?status=${status}` : ''}`).then((data) => data.orders),
    [status],
  );
  const conductors = useApi(() =>
    api<{ users: AdminUserRow[] }>('/admin/users?role=conductor&status=active').then((data) => data.users),
  );

  async function assign(orderId: number) {
    const pick = picks[orderId] ?? '';
    const result = await action.run(() =>
      api(`/admin/orders/${orderId}/assign`, { method: 'POST', body: { conductorId: pick ? Number(pick) : null } }),
    );
    if (result !== undefined) {
      setNote(t('admin.assigned', { id: orderId }));
      orders.reload();
    }
  }

  async function autoDispatch() {
    const result = await action.run(() => api<{ assigned: number; unassigned: number }>('/admin/dispatch', { method: 'POST' }));
    if (result) {
      setNote(t('admin.dispatchResult', { assigned: result.assigned, unassigned: result.unassigned }));
      orders.reload();
    }
  }

  return (
    <div className="page">
      <PageHeader
        title={t('admin.ordersTitle')}
        subtitle={t('admin.ordersSubtitle')}
        actions={
          <button className="btn primary" onClick={autoDispatch} disabled={action.busy}>
            {t('admin.autoDispatch')}
          </button>
        }
      />
      <div className="toolbar">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t('admin.allStatuses')}</option>
          {ORDER_STATUSES.map((option) => (
            <option key={option} value={option}>
              {statusLabel(option)}
            </option>
          ))}
        </select>
      </div>
      {note && <Notice tone="success">{note}</Notice>}
      {action.error && <ErrorState message={action.error} />}
      {orders.loading && !orders.data && <Loading />}
      {orders.error && <ErrorState message={orders.error} />}
      {orders.data && orders.data.length > 0 && (
        <Card>
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.colOrder')}</th>
                <th>{t('common.store')}</th>
                <th>{t('common.customer')}</th>
                <th>{t('common.status')}</th>
                <th className="right">{t('common.total')}</th>
                <th>{t('common.conductor')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((order) => {
                const assignable = order.status === 'preparing' || order.status === 'ready';
                return (
                  <tr key={order.id}>
                    <td>
                      <Link to={`/orders/${order.id}`}>#{order.id}</Link>
                      <div className="muted small">{formatDateTime(order.createdAt)}</div>
                    </td>
                    <td>{order.store.name}</td>
                    <td>{order.buyer.name}</td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="right price">{money(order.totalCents)}</td>
                    <td>
                      {order.conductor && <div className="small">{order.conductor.name}</div>}
                      {assignable && (
                        <div className="row-actions">
                          <select
                            value={picks[order.id] ?? ''}
                            onChange={(event) => setPicks((current) => ({ ...current, [order.id]: event.target.value }))}
                          >
                            <option value="">{t('admin.nearestFree')}</option>
                            {conductors.data?.map((conductor) => (
                              <option key={conductor.id} value={conductor.id}>
                                {t(conductor.isOnline ? 'admin.optionOnline' : 'admin.optionOffline', { name: conductor.name })}
                              </option>
                            ))}
                          </select>
                          <button className="btn small" disabled={action.busy} onClick={() => assign(order.id)}>
                            {order.conductor ? t('admin.reassign') : t('admin.assign')}
                          </button>
                        </div>
                      )}
                      {!order.conductor && !assignable && <span className="muted small">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {orders.data?.length === 0 && <Empty title={t('admin.noOrders')} />}
    </div>
  );
}

const AUDIENCE_LABEL: Record<AlertAudience, TranslationKey> = {
  vendors: 'admin.audVendors',
  buyers: 'admin.audBuyers',
  conductors: 'admin.audConductors',
};

export function AdminAlertsPage() {
  const action = useAction();
  const { t } = useI18n();
  const products = useApi(() => api<{ products: ProductSummary[] }>('/products?sort=name').then((data) => data.products));
  const alerts = useApi(() => api<{ alerts: AlertItem[] }>('/admin/alerts').then((data) => data.alerts));
  const [productId, setProductId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Record<AlertAudience, boolean>>({ vendors: true, buyers: true, conductors: true });
  const [result, setResult] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const selected = (Object.keys(audience) as AlertAudience[]).filter((key) => audience[key]);
    const response = await action.run(() =>
      api<{ recipients: { vendors: number; buyers: number; conductors: number; total: number } }>('/admin/alerts', {
        method: 'POST',
        body: {
          productId: productId ? Number(productId) : null,
          title: title.trim(),
          body: body.trim(),
          audience: selected,
        },
      }),
    );
    if (response) {
      const r = response.recipients;
      setResult(
        t('admin.sentResult', { total: r.total, vendors: r.vendors, buyers: r.buyers, conductors: r.conductors }),
      );
      setTitle('');
      setBody('');
      alerts.reload();
    }
  }

  return (
    <div className="page">
      <PageHeader
        title={t('admin.alertsTitle')}
        subtitle={t('admin.alertsSubtitle')}
      />
      <Card title={t('admin.sendAlertTitle')}>
        <form className="stack" onSubmit={send}>
          <div className="grid-2">
            <Field label={t('admin.target')}>
              <select value={productId} onChange={(event) => setProductId(event.target.value)}>
                <option value="">{t('admin.generalAnnouncement')}</option>
                {products.data?.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field">
              <span>{t('admin.sendTo')}</span>
              <div className="checks">
                {(Object.keys(AUDIENCE_LABEL) as AlertAudience[]).map((key) => (
                  <label key={key} className="checkbox">
                    <input
                      type="checkbox"
                      checked={audience[key]}
                      onChange={(event) => setAudience((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                    {t(AUDIENCE_LABEL[key])}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <Field label={t('admin.alertTitle')}>
            <input required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label={t('admin.alertMessage')}>
            <textarea required minLength={3} maxLength={1000} rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          {result && <Notice tone="success">{result}</Notice>}
          <div>
            <button className="btn primary" disabled={action.busy || !title.trim() || !body.trim()}>
              {action.busy ? t('admin.sending') : t('admin.sendButton')}
            </button>
          </div>
        </form>
      </Card>

      <Card title={t('admin.recentAlerts')}>
        {alerts.data?.length === 0 && <Empty title={t('admin.noAlerts')} />}
        {alerts.data && alerts.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.colSent')}</th>
                <th>{t('admin.colTarget')}</th>
                <th>{t('admin.colMessage')}</th>
                <th>{t('admin.colReached')}</th>
                <th>{t('admin.colBy')}</th>
              </tr>
            </thead>
            <tbody>
              {alerts.data.map((alert) => (
                <tr key={alert.id}>
                  <td className="small">{formatDateTime(alert.createdAt)}</td>
                  <td>{alert.productName ?? <Badge>{t('admin.allUsers')}</Badge>}</td>
                  <td>
                    <strong>{alert.title}</strong>
                    <div className="muted small">{alert.body}</div>
                  </td>
                  <td>{alert.recipients}</td>
                  <td className="small">{alert.createdByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function AdminSettingsPage() {
  const settings = useApi(() => api<{ settings: Settings }>('/admin/settings').then((data) => data.settings));
  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error && !settings.data) return <ErrorState message={settings.error} />;
  if (!settings.data) return null;
  return (
    <>
      <SettingsForm key={JSON.stringify(settings.data)} initial={settings.data} onSaved={settings.reload} />
      <CategoriesManager />
    </>
  );
}

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const { settings: publicSettings } = useSettings();
  const action = useAction();
  const { t } = useI18n();
  const currency = publicSettings?.currency ?? 'XOF';
  const [form, setForm] = useState({
    commissionPercent: String(initial.commissionPercent),
    baseFee: moneyInput(initial.baseDeliveryFeeCents, currency),
    perKm: moneyInput(initial.perKmFeeCents, currency),
    radius: String(initial.dispatchRadiusKm),
    lowStock: String(initial.lowStockThreshold),
  });
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const result = await action.run(() =>
      api('/admin/settings', {
        method: 'PUT',
        body: {
          commissionPercent: Number(form.commissionPercent),
          baseDeliveryFeeCents: Math.round(Number(form.baseFee) * 100),
          perKmFeeCents: Math.round(Number(form.perKm) * 100),
          dispatchRadiusKm: Number(form.radius),
          lowStockThreshold: Number(form.lowStock),
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
      <PageHeader title={t('admin.settingsTitle')} subtitle={t('admin.settingsSubtitle')} />
      <Card>
        <form className="grid-form" onSubmit={submit}>
          <Field label={t('admin.commissionPct')} hint={t('admin.commissionHint')}>
            <input type="number" min="0" max="50" step="0.5" value={form.commissionPercent} onChange={(e) => setForm({ ...form, commissionPercent: e.target.value })} />
          </Field>
          <Field label={t('admin.baseFee', { currency: currencyLabel(currency) })}>
            <input type="number" min="0" step={moneyStep(currency)} value={form.baseFee} onChange={(e) => setForm({ ...form, baseFee: e.target.value })} />
          </Field>
          <Field label={t('admin.perKm', { currency: currencyLabel(currency) })}>
            <input type="number" min="0" step={moneyStep(currency)} value={form.perKm} onChange={(e) => setForm({ ...form, perKm: e.target.value })} />
          </Field>
          <Field label={t('admin.radius')} hint={t('admin.radiusHint')}>
            <input type="number" min="1" max="100" step="0.5" value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} />
          </Field>
          <Field label={t('admin.lowStockAt')}>
            <input type="number" min="0" step="1" value={form.lowStock} onChange={(e) => setForm({ ...form, lowStock: e.target.value })} />
          </Field>
          <div className="span-2">
            {action.error && <Notice tone="danger">{action.error}</Notice>}
            {saved && <Notice tone="success">{t('admin.settingsSaved')}</Notice>}
            <button className="btn primary" disabled={action.busy}>
              {action.busy ? t('common.saving') : t('admin.saveSettings')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
function CategoriesManager() {
  const { t } = useI18n();
  const action = useAction();
  const cats = useApi(() => api<{ categories: { id: number; name: string }[] }>('/admin/categories').then((data) => data.categories));
  const [name, setName] = useState('');

  async function add() {
    if (name.trim().length < 2) return;
    const result = await action.run(() => api('/admin/categories', { method: 'POST', body: { name: name.trim() } }));
    if (result !== undefined) { setName(''); cats.reload(); }
  }

  async function remove(id: number) {
    if (!window.confirm(t('admin.deleteCategoryConfirm'))) return;
    const result = await action.run(() => api(`/admin/categories/${id}`, { method: 'DELETE' }));
    if (result !== undefined) cats.reload();
  }

  return (
    <Card title={t('admin.categories')}>
      <div className="row-gap">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.newCategory')} />
        <button className="btn primary" disabled={action.busy} onClick={add}>
          {action.busy ? t('common.saving') : t('common.save')}
        </button>
      </div>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <ul className="stack">
        {cats.data?.map((cat) => (
          <li key={cat.id} className="row-gap">
            <span>{cat.name}</span>
            <button className="btn small danger" onClick={() => remove(cat.id)}>
              {t('common.cancel')}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}