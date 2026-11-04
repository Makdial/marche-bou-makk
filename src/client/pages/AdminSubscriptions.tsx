import { useState } from 'react';
import { api } from '../api';
import { useApi, useAction } from '../hooks';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Card, Empty, ErrorState, Loading, Notice, PageHeader } from '../ui';
import type { AdminSubscription } from '../../shared/types';

export function AdminSubscriptionsPage() {
  const { t } = useI18n();
  const { money } = useSettings();
  const action = useAction();
  const [months, setMonths] = useState(1);
  const [planChoice, setPlanChoice] = useState<'starter' | 'growth' | 'pro'>('starter');
  const list = useApi(() => api<{ subscriptions: AdminSubscription[] }>('/admin/subscriptions').then((data) => data.subscriptions));

  async function activate(storeId: number) {
    const result = await action.run(() => api(`/admin/stores/${storeId}/plan`, { method: 'POST', body: { plan: planChoice, months } }));
    if (result !== undefined) list.reload();
  }

  async function pause(storeId: number) {
    if (!window.confirm(t('admin.pauseConfirm'))) return;
    const result = await action.run(() => api(`/admin/stores/${storeId}/pause`, { method: 'POST' }));
    if (result !== undefined) list.reload();
  }

  return (
    <div className="page">
      <PageHeader title={t('admin.subsTitle')} subtitle={t('admin.subsSubtitle')} />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <div className="row-gap">
        <select value={planChoice} onChange={(e) => setPlanChoice(e.target.value as any)}>
          <option value="starter">{t('plan.name.starter')}</option>
          <option value="growth">{t('plan.name.growth')}</option>
          <option value="pro">{t('plan.name.pro')}</option>
        </select>
        <input type="number" min={1} max={12} value={months} onChange={(e) => setMonths(Number(e.target.value))} />
      </div>
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorState message={list.error} />}
      {list.data && list.data.length === 0 && <Empty title={t('admin.noStores')} />}
      {list.data && list.data.length > 0 && (
        <Card>
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.colStore')}</th>
                <th>{t('admin.colPlan')}</th>
                <th>{t('admin.colSelling')}</th>
                <th>{t('admin.colUntil')}</th>
                <th>{t('admin.colProducts')}</th>
                <th>{t('admin.months')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((sub) => (
                <tr key={sub.storeId}>
                  <td>{sub.storeName}<br /><span className="muted small">{sub.ownerName}</span></td>
                  <td>{t(`plan.name.${sub.plan}` as any)}</td>
                  <td>{sub.selling ? t('plan.sellingBadge') : t('plan.pausedBadge')}</td>
                  <td>{sub.sellsUntil ? new Date(sub.sellsUntil).toLocaleDateString() : '—'}</td>
                  <td>{sub.productLimit === null ? `${sub.productCount}` : `${sub.productCount}/${sub.productLimit}`}</td>
                  <td></td>
                  <td>
                    <button className="btn small primary" disabled={action.busy} onClick={() => activate(sub.storeId)}>{t('admin.activate')}</button>
                    <button className="btn small danger" disabled={action.busy} onClick={() => pause(sub.storeId)}>{t('admin.pauseStore')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
