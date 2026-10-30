import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useCart } from '../cart';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Card, Empty, Notice, PageHeader, ProductImage } from '../ui';
import type { Quote } from '../../shared/types';

export function CartPage() {
  const { t } = useI18n();
  const cart = useCart();
  const { money } = useSettings();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const itemsKey = cart.items.map((line) => `${line.offerId}x${line.quantity}`).join(',');

  useEffect(() => {
    if (cart.items.length === 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let active = true;
    api<{ quote: Quote }>('/orders/quote', {
      body: { items: cart.items.map((line) => ({ offerId: line.offerId, quantity: line.quantity })) },
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
    // The key captures every line and quantity, so the quote refreshes exactly when the cart changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const byStore = useMemo(() => {
    const groups = new Map<string, typeof cart.items>();
    for (const line of cart.items) groups.set(line.storeName, [...(groups.get(line.storeName) ?? []), line]);
    return groups;
  }, [cart.items]);

  const localSubtotal = cart.items.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);

  return (
    <div className="page">
      <PageHeader title={t('cart.title')} subtitle={t('cart.subtitle')} />

      {cart.items.length === 0 ? (
        <Empty title={t('cart.empty')}>
          <Link to="/shop" className="btn primary">
            {t('cart.browse')}
          </Link>
        </Empty>
      ) : (
        <div className="two-col">
          <div className="stack">
            {[...byStore.entries()].map(([storeName, lines]) => (
              <Card key={storeName} title={`🏪 ${storeName}`}>
                {lines.map((line) => (
                  <div className="cart-line" key={line.offerId}>
                    <ProductImage size="sm" name={line.productName} url={line.imageUrl} />
                    <div className="grow">
                      <strong>{line.productName}</strong>
                      <div className="muted small">{t('cart.eachPrice', { price: money(line.priceCents) })}</div>
                    </div>
                    <div className="qty">
                      <button className="btn small" onClick={() => cart.setQuantity(line.offerId, line.quantity - 1)}>
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        className="btn small"
                        disabled={line.quantity >= line.stock}
                        onClick={() => cart.setQuantity(line.offerId, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="price">{money(line.priceCents * line.quantity)}</div>
                    <button className="btn ghost small" onClick={() => cart.remove(line.offerId)}>
                      {t('cart.remove')}
                    </button>
                  </div>
                ))}
              </Card>
            ))}
          </div>

          <Card title={t('cart.summary')}>
            {quoteError && <Notice tone="danger">{quoteError} {t('cart.unavailable')}</Notice>}
            {quote?.groups.map((group) => (
              <div className="summary-row" key={group.storeId}>
                <span>{group.storeName}</span>
                <span>{money(group.subtotalCents)}</span>
              </div>
            ))}
            <div className="summary-row">
              <span>{t('common.subtotal')}</span>
              <span>{money(quote?.subtotalCents ?? localSubtotal)}</span>
            </div>
            <div className="summary-row muted">
              <span>{t('common.delivery')}</span>
              <span>{t('cart.deliveryAtCheckout')}</span>
            </div>
            <Link to="/checkout" className="btn primary block">
              {t('cart.checkout')}
            </Link>
          </Card>
        </div>
      )}
    </div>
  );
}
