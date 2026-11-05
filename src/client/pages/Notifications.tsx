import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLive } from '../live';
import { timeAgo } from '../format';
import { useAction, useApi } from '../hooks';
import { renderMessage, useI18n } from '../i18n';
import { Badge, Card, Empty, ErrorState, Loading, Notice, PageHeader } from '../ui';
import type { NotificationItem } from '../../shared/types';
import type { TranslationKey } from '../../shared/i18n/en';

const TYPE_CATEGORY: Record<string, TranslationKey> = {
  'order.placed': 'notif.categoryOrder',
  'order.new': 'notif.categoryOrder',
  'order.accepted': 'notif.categoryOrder',
  'order.rejected': 'notif.categoryOrder',
  'order.cancelled': 'notif.categoryOrder',
  'order.ready': 'notif.categoryOrder',
  'order.assigned': 'notif.categoryOrder',
  'order.picked_up': 'notif.categoryOrder',
  'order.delivered': 'notif.categoryOrder',
  'order.on_the_way': 'notif.categoryOrder',
  'order.paid': 'notif.categoryOrder',
  'order.cash_received': 'notif.categoryOrder',
  'job.available': 'notif.categoryDelivery',
  'job.ready': 'notif.categoryDelivery',
  'job.assigned': 'notif.categoryDelivery',
  'job.reassigned': 'notif.categoryDelivery',
  'product.alert': 'notif.categoryAlert',
  'product.price_changed': 'notif.categoryProduct',
  'product.out_of_stock': 'notif.categoryProduct',
  'product.back_in_stock': 'notif.categoryProduct',
  'product.low_stock': 'notif.categoryProduct',
  'product.new_seller': 'notif.categoryProduct',
  'account.approved': 'notif.categoryAccount',
  'account.suspended': 'notif.categoryAccount',
  announcement: 'notif.categoryAnnouncement',
};

export function NotificationsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { setUnread } = useLive();
  const action = useAction();
  const navigate = useNavigate();
  const list = useApi(() => api<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications?limit=100'));
  const [permission, setPermission] = useState<string>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  async function markAll() {
    const result = await action.run(() => api<{ unreadCount: number }>('/notifications/read', { method: 'POST', body: {} }));
    if (result) {
      setUnread(result.unreadCount);
      list.reload();
    }
  }

  async function open(item: NotificationItem) {
    if (!item.readAt) {
      const result = await action.run(() =>
        api<{ unreadCount: number }>('/notifications/read', { method: 'POST', body: { ids: [item.id] } }),
      );
      if (result) setUnread(result.unreadCount);
    }
    if (typeof item.data.orderId === 'number') navigate(`/orders/${item.data.orderId}`);
    else if (typeof item.data.productId === 'number' && user?.role === 'buyer') navigate(`/shop/products/${item.data.productId}`);
    list.reload();
  }

  async function enableDesktop() {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  }

  return (
    <div className="page">
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          <>
            {permission !== 'granted' && permission !== 'unsupported' && (
              <button className="btn" onClick={enableDesktop}>
                {t('notifications.enableDesktop')}
              </button>
            )}
            <button className="btn primary" onClick={markAll} disabled={action.busy || !list.data?.unreadCount}>
              {t('notifications.markAll')}
            </button>
          </>
        }
      />
      {permission === 'denied' && <Notice tone="warn">{t('notifications.blocked')}</Notice>}
      {action.error && <ErrorState message={action.error} />}
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorState message={list.error} />}
      {list.data?.notifications.length === 0 && (
        <Empty title={t('notifications.empty')}>{t('notifications.emptyHint')}</Empty>
      )}
      <div className="stack">
        {list.data?.notifications.map((item) => (
          <button key={item.id} className={`notification ${item.readAt ? '' : 'unread'}`} onClick={() => open(item)}>
            <div className="notification-head">
              <div className="row-gap">
                {!item.readAt && <span className="dot-new" aria-label={t('notifications.unread')} />}
                <strong>{renderMessage(item.titleKey, item.params, item.title)}</strong>
              </div>
              <span className="muted small">{timeAgo(item.createdAt)}</span>
            </div>
            <p>{renderMessage(item.bodyKey, item.params, item.body)}</p>
            <Badge>{TYPE_CATEGORY[item.type] ? t(TYPE_CATEGORY[item.type]) : item.type}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
