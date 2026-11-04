import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
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

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 20a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

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
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('drawer-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('drawer-open');
    };
  }, [menuOpen]);

  if (!user) return null;
  const pending = user.status !== 'active';

  return (
    <div className="shell">
      <header className="mobile-bar">
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.menu')}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon />
        </button>
        <Link to="/" className="mobile-brand">
          <span className="logo">MB</span>
          <span>{t('app.name')}</span>
        </Link>
        <div className="mobile-actions">
          <Link to="/messages" className="icon-btn" aria-label={t('nav.messages')}>
            <ChatIcon />
            {chatUnread > 0 && <span className="count alert">{chatUnread}</span>}
          </Link>
          <Link to="/notifications" className="icon-btn" aria-label={t('nav.notifications')}>
            <BellIcon />
            {unread > 0 && <span className="count alert">{unread}</span>}
          </Link>
        </div>
      </header>

      <button
        type="button"
        className={`drawer-backdrop ${menuOpen ? 'show' : ''}`}
        aria-label={t('common.close')}
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />

      <aside id="app-sidebar" className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <Link to="/" className="brand">
            <span className="logo">MB</span>
            <span>{t('app.name')}</span>
          </Link>
          <button type="button" className="icon-btn sidebar-close" aria-label={t('common.close')} onClick={() => setMenuOpen(false)}>
            ×
          </button>
        </div>
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
