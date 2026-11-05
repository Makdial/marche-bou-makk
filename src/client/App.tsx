import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useAuth, HOME_PATH } from './auth';
import { useI18n } from './i18n';
import Layout from './components/Layout';
import { Loading, Empty } from './ui';
import type { Role } from '../shared/types';
import { LoginPage, RegisterPage } from './pages/Auth';
import { ShopPage } from './pages/Shop';
import { ProductPage } from './pages/ProductPage';
import { CartPage } from './pages/Cart';
import { CheckoutPage } from './pages/Checkout';
import { MyOrdersPage, OrderPage } from './pages/Orders';
import { VendorOverviewPage, VendorOrdersPage, VendorProductsPage, VendorStorePage } from './pages/VendorPages';
import { VendorPlanPage } from './pages/VendorPlan';
import { StorePage } from './pages/StorePage';
import { GpProfilePage } from './pages/GpProfilePage';
import { AdminSubscriptionsPage } from './pages/AdminSubscriptions';
import { ConductorHomePage, ConductorEarningsPage } from './pages/ConductorPages';
import { GpDashboardPage, GpPeoplePage } from './pages/GpPages';
import { AdminOverviewPage, AdminPeoplePage, AdminOrdersPage, AdminAlertsPage, AdminSettingsPage } from './pages/AdminPages';
import { AdminReportsPage } from './pages/AdminReports';
import { NotificationsPage } from './pages/Notifications';
import { AdminMapPage } from './pages/AdminMap';
import { MessagesPage } from './pages/Messages';

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();
  if (user && user.role !== role) return <Navigate to={HOME_PATH[user.role]} replace />;
  return <Outlet />;
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? HOME_PATH[user.role] : '/login'} replace />;
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="page">
      <Empty title={t('common.pageNotFound')}>{t('common.pageNotFoundText')}</Empty>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/:conversationId" element={<MessagesPage />} />
          <Route path="orders/:id" element={<OrderPage />} />

          <Route element={<RequireRole role="buyer" />}>
            <Route path="shop" element={<ShopPage />} />
            <Route path="shop/products/:id" element={<ProductPage />} />
          <Route path="shop/stores/:id" element={<StorePage />} />
            <Route path="shop/gps/:id" element={<GpProfilePage />} />
            <Route path="cart" element={<CartPage />} />
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="orders" element={<MyOrdersPage />} />
          </Route>

          <Route element={<RequireRole role="vendor" />}>
            <Route path="vendor" element={<VendorOverviewPage />} />
            <Route path="vendor/orders" element={<VendorOrdersPage />} />
            <Route path="vendor/products" element={<VendorProductsPage />} />
            <Route path="vendor/store" element={<VendorStorePage />} />
          <Route path="vendor/plan" element={<VendorPlanPage />} />
          </Route>

          <Route element={<RequireRole role="conductor" />}>
            <Route path="conductor" element={<ConductorHomePage />} />
            <Route path="conductor/earnings" element={<ConductorEarningsPage />} />
          </Route>

          <Route element={<RequireRole role="gp" />}>
            <Route path="gp" element={<GpDashboardPage />} />
            <Route path="gp/people" element={<GpPeoplePage />} />
          </Route>

          <Route element={<RequireRole role="admin" />}>
            <Route path="admin" element={<AdminOverviewPage />} />
            <Route path="admin/people" element={<AdminPeoplePage />} />
            <Route path="admin/orders" element={<AdminOrdersPage />} />
            <Route path="admin/map" element={<AdminMapPage />} />
            <Route path="admin/alerts" element={<AdminAlertsPage />} />
            <Route path="admin/settings" element={<AdminSettingsPage />} />
          <Route path="admin/reports" element={<AdminReportsPage />} />
          <Route path="admin/subscriptions" element={<AdminSubscriptionsPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
