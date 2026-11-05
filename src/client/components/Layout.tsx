import { useEffect, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { BrandMark } from '../brand';
import { useCart } from '../cart';
import { roleLabel } from '../format';
import { useI18n } from '../i18n';
import { Icon, type IconName } from '../icons';
import { useLive } from '../live';
import { Notice } from '../ui';
import { DriverTracker } from './DriverTracker';
import { Preferences } from './Preferences';
import { NotificationsMenu } from './NotificationsMenu';
import type { TranslationKey } from '../../shared/i18n/en';
import type { Role } from '../../shared/types';

interface NavLinkItem {
  to: string;
  label: TranslationKey;
  icon: IconName;
  end?: boolean;
}

const NAV: Record<Role, NavLinkItem[]> = {
  buyer: [
    { to: '/shop', label: 'nav.shop', icon: 'store' },
    { to: '/cart', label: 'nav.cart', icon: 'cart' },
    { to: '/orders', label: 'nav.orders', icon: 'receipt' },
  ],
  vendor: [
    { to: '/vendor', label: 'nav.vendorOverview', icon: 'chart', end: true },
    { to: '/vendor/orders', label: 'nav.vendorOrders', icon: 'receipt' },
    { to: '/vendor/products', label: 'nav.vendorProducts', icon: 'box' },
    { to: '/vendor/store', label: 'nav.vendorStore', icon: 'store' },
    { to: '/vendor/plan', label: 'nav.vendorPlan', icon: 'star' },
  ],
  conductor: [
    { to: '/conductor', label: 'nav.conductorDispatch', icon: 'truck', end: true },
    { to: '/conductor/earnings', label: 'nav.conductorEarnings', icon: 'wallet' },
  ],
  gp: [
    { to: '/gp', label: 'nav.gpDashboard', icon: 'globe', end: true },
    { to: '/gp/people', label: 'nav.gpPeople', icon: 'users' },
  ],
  admin: [
    { to: '/admin', label: 'nav.adminOverview', icon: 'chart', end: true },
    { to: '/admin/people', label: 'nav.adminPeople', icon: 'users' },
    { to: '/admin/orders', label: 'nav.adminOrders', icon: 'receipt' },
    { to: '/admin/map', label: 'nav.adminMap', icon: 'map' },
    { to: '/admin/alerts', label: 'nav.adminAlerts', icon: 'alert' },
    { to: '/admin/subscriptions', label: 'nav.adminSubscriptions', icon: 'card' },
    { to: '/admin/reports', label: 'nav.adminReports', icon: 'chart' },
    { to: '/admin/settings', label: 'nav.adminSettings', icon: 'sliders' },
  ],
};

const MESSAGES: NavLinkItem = { to: '/messages', label: 'nav.messages', icon: 'chat' };

// Phones get a bottom bar with the pages used most often. The drawer keeps the full list.
const TABS: Record<Role, NavLinkItem[]> = {
  buyer: [NAV.buyer[0], NAV.buyer[1], NAV.buyer[2], MESSAGES],
  vendor: [NAV.vendor[0], NAV.vendor[1], NAV.vendor[2], NAV.vendor[3]],
  conductor: [NAV.conductor[0], NAV.conductor[1], MESSAGES],
  gp: [NAV.gp[0], NAV.gp[1], MESSAGES],
  admin: [NAV.admin[0], NAV.admin[1], NAV.admin[2], NAV.admin[3]],
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
  const tabs = TABS[user.role];

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        {t('common.skipToContent')}
      </a>

      <header className="mobile-bar">
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.menu')}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" size={22} />
        </button>
        <Link to="/" className="mobile-brand">
          <span className="logo">
            <BrandMark size={36} />
          </span>
          <span>{t('app.name')}</span>
        </Link>
        <div className="mobile-actions">
          <Link to="/messages" className="icon-btn" aria-label={t('nav.messages')}>
            <Icon name="chat" size={22} />
            {chatUnread > 0 && <span className="count alert">{chatUnread}</span>}
          </Link>
          <Link to="/notifications" className="icon-btn" aria-label={t('nav.notifications')}>
            <Icon name="bell" size={22} />
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
            <span className="logo">
              <BrandMark size={36} />
            </span>
            <span>{t('app.name')}</span>
          </Link>
          <button type="button" className="icon-btn sidebar-close" aria-label={t('common.close')} onClick={() => setMenuOpen(false)}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="role-pill">{roleLabel(user.role)}</div>
        <nav className="nav" aria-label={t('common.mainNav')}>
          {NAV[user.role].map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className="nav-link">
              <Icon name={link.icon} />
              <span>{t(link.label)}</span>
              {link.to === '/cart' && count > 0 && <span className="count">{count}</span>}
            </NavLink>
          ))}
          <NavLink to={MESSAGES.to} className="nav-link">
            <Icon name={MESSAGES.icon} />
            <span>{t(MESSAGES.label)}</span>
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
            <Icon name="logout" size={18} />
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      <main id="main" className="content" tabIndex={-1}>
        {pending && (user.role === 'vendor' || user.role === 'conductor') && (
          <Notice tone="warn">{t('layout.pending', { role: roleLabel(user.role).toLowerCase() })}</Notice>
        )}
        <DriverTracker />
        <Outlet />
      </main>

      <nav className="tabbar" aria-label={t('common.mainNav')} style={{ '--tabs': tabs.length } as CSSProperties}>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="tabbar-link">
            <span className="tabbar-icon">
              <Icon name={tab.icon} size={22} />
              {tab.to === '/cart' && count > 0 && <span className="count">{count}</span>}
              {tab.to === MESSAGES.to && chatUnread > 0 && <span className="count alert">{chatUnread}</span>}
            </span>
            <span className="tabbar-label">{t(tab.label)}</span>
          </NavLink>
        ))}
      </nav>

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
