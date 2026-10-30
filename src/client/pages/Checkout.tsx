import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import { LocationInput } from '../components/LocationInput';
import { useAction } from '../hooks';
import { formatKm } from '../format';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Card, Empty, Field, Notice, PageHeader } from '../ui';
import type { OrderView, Point, Quote } from '../../shared/types';

export function CheckoutPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const cart = useCart();
  const { money, settings } = useSettings();
  const navigate = useNavigate();
  const action = useAction();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    address: user?.address ?? '',
    notes: '',
  });
  const [point, setPoint] = useState<Point | null>(
    user?.lat !== null && user?.lat !== undefined && user?.lng !== null && user?.lng !== undefined
      ? { lat: user.lat, lng: user.lng }
      : null,
  );
  const [paymentMethod, setPaymentMethod] = useState<'mobile_money' | 'cash'>('mobile_money');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const itemsKey = cart.items.map((line) => `${line.offerId}x${line.quantity}`).join(',');

  useEffect(() => {
    if (cart.items.length === 0) return;
    let active = true;
    api<{ quote: Quote }>('/orders/quote', {
      body: {
        items: cart.items.map((line) => ({ offerId: line.offerId, quantity: line.quantity })),
        delivery: point ?? undefined,
      },
    })
      .then((data) => {
        if (!active) return;
        setQuote(data.quote);
        setQuoteError(null);
      })
      .catch((error: Error) => {
        if (!active) return;
        setQuote(null);
        setQuoteError(error.message);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, point?.lat, point?.lng]);

  if (cart.items.length === 0) {
    return (
      <div className="page">
        <Empty title={t('checkout.nothing')}>
          <Link to="/shop" className="btn primary">
            {t('cart.browse')}
          </Link>
        </Empty>
      </div>
    );
  }

  const localSubtotal = cart.items.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!point) return;
    const result = await action.run(() =>
      api<{ checkoutId: string; orders: OrderView[] }>('/orders', {
        body: {
          items: cart.items.map((line) => ({ offerId: line.offerId, quantity: line.quantity })),
          paymentMethod,
          delivery: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            address: form.address.trim(),
            lat: point.lat,
            lng: point.lng,
            notes: form.notes.trim() || undefined,
          },
        },
      }),
    );
    if (result) {
      cart.clear();
      navigate('/orders', { state: { placed: result.orders.length } });
    }
  }

  return (
    <div className="page">
      <PageHeader title={t('checkout.title')} subtitle={t('checkout.subtitle')} />
      <div className="two-col">
        <Card title={t('checkout.deliveryDetails')}>
          <form className="stack" onSubmit={submit}>
            <div className="grid-2">
              <Field label={t('checkout.recipient')}>
                <input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('checkout.phoneForConductor')}>
                <input required minLength={6} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>
            <Field label={t('common.address')}>
              <input required minLength={5} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t('checkout.mapLocation')} hint={t('checkout.mapHint')}>
              <LocationInput value={point} onChange={setPoint} />
            </Field>
            <Field label={t('checkout.notes')}>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('checkout.notesPlaceholder')} />
            </Field>

            <fieldset className="payment">
              <legend>{t('checkout.payment')}</legend>
              <label className="radio">
                <input type="radio" checked={paymentMethod === 'mobile_money'} onChange={() => setPaymentMethod('mobile_money')} />
                <span className="radio-text"><strong>{t('pay.mobile_money')}</strong><small className="muted">{t('checkout.mobileMoneyHint')}</small></span>
              </label>
              <label className="radio">
                <input type="radio" checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} />
                {t('pay.cash')}
              </label>
            </fieldset>

            {action.error && <Notice tone="danger">{action.error}</Notice>}
            <button className="btn primary block" disabled={action.busy || !point}>
              {action.busy ? t('checkout.placing') : t('checkout.placeOrders', { count: quote?.groups.length ?? 1 })}
            </button>
            {!point && <small className="muted">{t('checkout.setLocation')}</small>}
          </form>
        </Card>

        <Card title={t('checkout.yourOrder')}>
          {quoteError && <Notice tone="danger">{quoteError}</Notice>}
          {quote?.groups.map((group) => (
            <div key={group.storeId} className="summary-group">
              <div className="summary-row">
                <strong>🏪 {group.storeName}</strong>
                <span>{money(group.totalCents)}</span>
              </div>
              <div className="muted small">
                {group.lines.map((line) => `${line.quantity} × ${line.productName}`).join(' · ')}
              </div>
              <div className="summary-row">
                <span>{t('common.subtotal')}</span>
                <span>{money(group.subtotalCents)}</span>
              </div>
              <div className="summary-row">
                <span>{t('order.deliveryFee')}</span>
                <span>{t('order.deliveryIncluded')}</span>
              </div>
              <div className="summary-row total">
                <span>{t('common.total')}</span>
                <span>{money(group.totalCents)}</span>
              </div>
              {group.distanceKm !== null && <div className="muted small">{formatKm(group.distanceKm)}</div>}
            </div>
          ))}
          {!quote && <p className="muted small">{t('common.subtotal')} {money(localSubtotal)}</p>}
          <div className="summary-row total">
            <span>{t('common.total')}</span>
            <span>{money(quote?.totalCents ?? localSubtotal)}</span>
          </div>
          {!point && <Notice tone="info">{t('checkout.feesAfterLocation')}</Notice>}
          {settings && (
            <p className="muted small">
              {t('checkout.feeRule', {
                base: money(settings.baseDeliveryFeeCents),
                perKm: money(settings.perKmFeeCents),
              })}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
