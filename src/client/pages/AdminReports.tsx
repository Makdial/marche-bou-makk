import { useState } from 'react';
import { api } from '../api';
import { useApi, useAction } from '../hooks';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Card, Empty, ErrorState, Loading, Notice, PageHeader } from '../ui';
import type { AdminSubscription } from '../../shared/types';

// Simple admin reports: platform totals + per-store sales from orders.
export function AdminReportsPage() {
  const { t } = useI18n();
  const { money } = useSettings();
  const action = useAction();
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const orders = useApi(() => api<{ orders: any[] }>('/admin/orders').then((data) => data.orders ?? []));

  const filtered = (orders.data ?? []).filter((o: any) => {
    if (period === 'all') return true;
    const created = new Date(o.createdAt).getTime();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (period === 'today') return now - created < day;
    if (period === 'week') return now - created < 7 * day;
    if (period === 'month') return now - created < 30 * day;
    return true;
  });

  const totalRevenue = filtered.reduce((s: number, o: any) => s + (o.totalCents ?? 0), 0);
  const totalOrders = filtered.length;

  async function sendReport(storeId: number, storeName: string) {
    const storeOrders = filtered.filter((o: any) => o.store?.id === storeId || o.storeId === storeId);
    const revenue = storeOrders.reduce((s: number, o: any) => s + (o.totalCents ?? 0), 0);
    const result = await action.run(() =>
      api('/admin/alerts', {
        method: 'POST',
        body: {
          title: `Sales report: ${storeName}`,
          body: `Period: ${period}. Orders: ${storeOrders.length}. Revenue: ${money(revenue)}.`,
          audience: ['vendors'],
          productId: null,
        },
      }),
    );
    if (result !== undefined) {
      // no-op; alert sent
    }
  }

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Platform and per-store sales." actions={<button className="btn small" onClick={() => window.print()}>Print report</button>} />
      <div className="toolbar">
        <select value={period} onChange={(e) => setPeriod(e.target.value as any)}>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
      </div>
      {orders.loading && !orders.data && <Loading />}
      {orders.error && <ErrorState message={orders.error} />}
      <div className="stats">
        <div className="stat"><span className="stat-label">Orders</span><strong className="stat-value">{totalOrders}</strong></div>
        <div className="stat"><span className="stat-label">Revenue</span><strong className="stat-value">{money(totalRevenue)}</strong></div>
      </div>
      <Card title="Per store">
        {filtered.length === 0 && <Empty title="No orders" />}
        <table className="table">
          <thead>
            <tr>
              <th>Store</th>
              <th>Orders</th>
              <th>Revenue</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {Array.from(new Set(filtered.map((o: any) => o.store?.id ?? o.storeId))).map((storeId) => {
              const storeOrders = filtered.filter((o: any) => (o.store?.id ?? o.storeId) === storeId);
              const storeName = storeOrders[0]?.store?.name ?? `Store ${storeId}`;
              const revenue = storeOrders.reduce((s: number, o: any) => s + (o.totalCents ?? 0), 0);
              return (
                <tr key={storeId}>
                  <td>{storeName}</td>
                  <td>{storeOrders.length}</td>
                  <td>{money(revenue)}</td>
                  <td>
                    <button className="btn small" disabled={action.busy} onClick={() => sendReport(storeId as number, storeName)}>
                      Send report
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </div>
  );
}
