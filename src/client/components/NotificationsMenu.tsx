import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useApi } from '../hooks';
import { useI18n } from '../i18n';
import { renderMessage, tr } from '../i18n';
import { timeAgo } from '../format';
import type { NotificationItem } from '../../shared/types';

export function NotificationsMenu({ unread }: { unread: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useApi(() => (open ? api<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications?limit=8') : Promise.resolve({ notifications: [], unreadCount: 0 })), [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markAll() {
    await api('/notifications/read', { method: 'POST' }).catch(() => undefined);
    setOpen(false);
    navigate('/notifications');
  }

  return (
    <div className="notif-menu" ref={ref}>
      <button type="button" className="nav-link notif-trigger" onClick={() => setOpen((v) => !v)}>
        <span>{t('nav.notifications')}</span>
        {unread > 0 && <span className="count alert">{unread}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <strong>{t('notifications.title')}</strong>
            {unread > 0 && (
              <button type="button" className="link" onClick={markAll}>
                {t('notifications.markAll')}
              </button>
            )}
          </div>
          {list.loading && !list.data && <p className="muted small">Loading…</p>}
          {list.data && list.data.notifications.length === 0 && (
            <p className="muted small">{t('notifications.empty')}</p>
          )}
          <ul className="notif-dropdown-list">
            {list.data?.notifications.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="notif-dropdown-item"
                  onClick={() => {
                    setOpen(false);
                    navigate('/notifications');
                  }}
                >
                  <span className="notif-dropdown-title">{renderMessage(item.titleKey, item.params, item.title)}</span>
                  <span className="notif-dropdown-body">{renderMessage(item.bodyKey, item.params, item.body)}</span>
                  <span className="muted small">{timeAgo(item.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" className="notif-dropdown-all" onClick={() => setOpen(false)}>
            {t('notifications.subtitle')} →
          </Link>
        </div>
      )}
    </div>
  );
}
