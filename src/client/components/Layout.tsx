import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import { roleLabel } from '../format';
import { useI18n } from '../i18n';
import { useLive } from '../live';
import { Notice } from '../ui';
import { Preferences } from './Preferences';
import { NotificationsMenu } from './NotificationsMenu';
import type { TranslationKey } from '../../shared/i18n/en';
import type { Role } from '../../shared/types';

interface NavLinkItem {
  to: string;
  label: TranslationKey;
  end?: boolean;
}

const NAV: Record<Role, NavLinkItem[]> = {
  buyer: [
    { to: '/shop', label: 'nav.shop' },
    { to: '/cart', label: 'nav.cart' },
    { to: '/orders', label: 'nav.orders' },
  ],
  vendor: [
    { to: '/vendor', label: 'nav.vendorOverview', end: true },
    { to: '/vendor/orders', label: 'nav.vendorOrders' },
    { to: '/vendor/products', label: 'nav.vendorProducts' },
    { to: '/vendor/store', label: 'nav.vendorStore' },
    { to: '/vendor/plan', label: 'nav.vendorPlan' },
  ],
  conductor: [
    { to: '/conductor', label: 'nav.conductorDispatch', end: true },
    { to: '/conductor/earnings', label: 'nav.conductorEarnings' },
  ],
  gp: [
    { to: '/gp', label: 'nav.gpDashboard', end: true },
    { to: '/gp/people', label: 'nav.gpPeople' },
  ],
  admin: [
    { to: '/admin', label: 'nav.adminOverview', end: true },
    { to: '/admin/people', label: 'nav.adminPeople' },
    { to: '/admin/orders', label: 'nav.adminOrders' },
    { to: '/admin/map', label: 'nav.adminMap' },
    { to: '/admin/alerts', label: 'nav.adminAlerts' },
    { to: '/admin/subscriptions', label: 'nav.adminSubscriptions' },
    { to: '/admin/reports', label: 'nav.adminReports' },
    { to: '/admin/settings', label: 'nav.adminSettings' },
  ],
};

export default function Layout() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const { unread, chatUnread, connected, toasts, dismissToast } = useLive();
  const { count } = useCart();
  const navigate = useNavigate();

  if (!user) return null;
  const pending = user.status !== 'active';

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="logo">MB</span>
          <span>{t('app.name')}</span>
        </Link>
        <div className="role-pill">{roleLabel(user.role)}</div>
        <nav className="nav">
          {NAV[user.role].map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className="nav-link">
              <span>{t(link.label)}</span>
              {link.to === '/cart' && count > 0 && <span className="count">{count}</span>}
            </NavLink>
          ))}
          <NavLink to="/messages" className="nav-link">
            <span>{t('nav.messages')}</span>
            {chatUnread > 0 && <span className="count alert">{chatUnread}</span>}
          </NavLink>
          <NotificationsMenu unread={unread} />
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <div className={`live ${connected ? 'on' : ''}`}>{connected ? t('common.liveOn') : t('common.reconnecting')}</div>
          <Preferences />
          <button
            className="btn ghost small"
            onClick={() => {
              signOut();
              navigate('/login');
            }}
          >
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      <main className="content">
        {pending && (user.role === 'vendor' || user.role === 'conductor') && (
          <Notice tone="warn">{t('layout.pending', { role: roleLabel(user.role).toLowerCase() })}</Notice>
        )}
        <Outlet />
      </main>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            className="toast"
            onClick={() => {
              dismissToast(toast.id);
              navigate(toast.to);
            }}
          >
            <strong>{toast.title}</strong>
            <span>{toast.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
