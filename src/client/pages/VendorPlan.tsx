import { Link } from 'react-router';
import { api } from '../api';
import { useApi, useAction } from '../hooks';
import { useSettings } from '../settings';
import { useI18n } from '../i18n';
import { Badge, Card, Empty, ErrorState, Loading, Notice, PageHeader } from '../ui';
import { PLANS, PURCHASABLE_PLANS } from '../../shared/plans';
import type { VendorPlan as VendorPlanData } from '../../shared/types';

export function VendorPlanPage() {
  const { t } = useI18n();
  const { money } = useSettings();
  const action = useAction();
  const plan = useApi(() => api<{ plan: VendorPlanData }>('/vendor/plan').then((data) => data.plan));

  if (plan.loading && !plan.data) return <Loading />;
  if (plan.error && !plan.data) return <ErrorState message={plan.error} />;

  const current = plan.data;
  const planName = (id: string) => t(`plan.name.${id}` as any);

  return (
    <div className="page">
      <PageHeader title={t('plan.title')} subtitle={t('plan.subtitle')} />
      {current && (
        <Card title={t('plan.current')}>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">{t('plan.current')}</span>
              <strong className="stat-value">{planName(current.plan)}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">{t('common.status')}</span>
              <strong className="stat-value">{current.selling ? t('plan.sellingBadge') : t('plan.pausedBadge')}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">{t('plan.daysLeft', { count: current.daysLeft })}</span>
              <strong className="stat-value">{current.daysLeft}</strong>
            </div>
          </div>
          <p className="muted small">{t('plan.sellingUntil', { date: new Date(current.sellsUntil ?? '').toLocaleDateString() })}</p>
          <p className="muted small">
            {current.productLimit === null
              ? t('plan.usageUnlimited', { used: current.productCount })
              : t('plan.usage', { used: current.productCount, limit: current.productLimit })}
          </p>
          <p className="muted small">{t('plan.transportExplain')}</p>
          <p className="muted small">
            {t('plan.transportRates', { base: money(0), perKm: money(0) })}
          </p>
          {!current.selling && <Notice tone="danger">{t('plan.paused')}</Notice>}
        </Card>
      )}

      <Card title={t('plan.compare')}>
        <div className="grid-cards">
          {PURCHASABLE_PLANS.map((details) => (
            <Card key={details.id} title={planName(details.id)}>
              <div className="price">{money(details.priceCents)}</div>
              <p className="muted small">{t('plan.price', { price: money(details.priceCents) })}</p>
              <p className="muted small">
                {details.productLimit === null
                  ? t('plan.productsUnlimited')
                  : t('plan.productsUpTo', { count: details.productLimit })}
              </p>
              <p className="muted small">
                {details.transportSharePercent === 100
                  ? t('plan.transportFull')
                  : details.transportSharePercent === 0
                    ? t('plan.transportFree')
                    : t('plan.transportOff', { percent: 100 - details.transportSharePercent })}
              </p>
              {current?.plan === details.id && <Badge tone="success">{t('plan.current')}</Badge>}
            </Card>
          ))}
        </div>
      </Card>

      <Card title={t('plan.subscribeTitle')}>
        <p className="muted">{t('plan.subscribeText')}</p>
        <Link to="/messages?with=1" className="btn primary">{t('plan.messageAdmin')}</Link>
      </Card>

      <Card title={t('plan.trialText', { days: 30, limit: 30 })}>
        <p className="muted small">{t('plan.trialText', { days: 30, limit: 30 })}</p>
      </Card>
    </div>
  );
}
