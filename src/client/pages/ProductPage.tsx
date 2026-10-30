import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import { categoryLabel } from '../format';
import { useAction, useApi } from '../hooks';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Badge, Card, ErrorState, Loading, Notice, ProductImage } from '../ui';
import { ImageZoom } from '../components/ImageZoom';
import type { ProductDetail } from '../../shared/types';

export function ProductPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const { user } = useAuth();
  const cart = useCart();
  const { money } = useSettings();
  const action = useAction();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [added, setAdded] = useState<string | null>(null);
  const detail = useApi(() => api<{ product: ProductDetail }>(`/products/${id}`).then((data) => data.product), [id]);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error && !detail.data) return <ErrorState message={detail.error} />;
  const product = detail.data;
  if (!product) return null;
  const isBuyer = user?.role === 'buyer';

  async function toggleWatch() {
    const result = await action.run(() =>
      api(`/products/${product!.id}/watch`, { method: product!.watching ? 'DELETE' : 'POST' }),
    );
    if (result !== undefined) detail.reload();
  }

  function addToCart(offerId: number, quantity: number) {
    const offer = product!.offers.find((item) => item.offerId === offerId);
    if (!offer) return;
    cart.add(
      {
        offerId: offer.offerId,
        productId: product!.id,
        productName: product!.name,
        storeId: offer.storeId,
        storeName: offer.storeName,
        priceCents: offer.priceCents,
        stock: offer.stock,
        imageUrl: product!.imageUrl,
      },
      quantity,
    );
    setAdded(t('product.added', { quantity, product: product!.name, store: offer.storeName }));
  }

  return (
    <div className="page">
      <Link to="/shop" className="back">
        ← {t('product.back')}
      </Link>

      <div className="product-hero">
        {product.imageUrl ? (
  <ImageZoom src={product.imageUrl} alt={product.name} thumbnails={product.offers.filter((o) => o.imageUrl).map((o) => ({ src: o.imageUrl!, label: o.storeName }))} />
) : (
  <ProductImage name={product.name} url={null} size="lg" />
)}
        <div className="stack">
          <span className="muted">
            {product.categoryName ? categoryLabel(product.categoryName) : t('shop.uncategorized')}
          </span>
          <h1>{product.name}</h1>
          <p>{product.description ?? t('product.noDescription')}</p>
          <div className="price-row">
            <span className="price big">{t('shop.fromPrice', { price: money(product.minPriceCents) })}</span>
            <Badge tone={product.inStockOffers > 0 ? 'success' : 'danger'}>
              {product.inStockOffers > 0
                ? t('product.storesInStock', { count: product.inStockOffers })
                : t('product.soldOutEverywhere')}
            </Badge>
          </div>
          {isBuyer && (
            <div>
              <button className="btn" onClick={toggleWatch} disabled={action.busy}>
                {product.watching ? t('product.unwatch') : t('product.watch')}
              </button>
            </div>
          )}
          {action.error && <ErrorState message={action.error} />}
        </div>
      </div>

      {added && <Notice tone="success">{added}</Notice>}

      <Card title={t('product.compare', { count: product.offers.length })}>
        {product.offers.length === 0 ? (
          <p className="muted">{t('product.noOffers')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.store')}</th>
                <th>{t('common.price')}</th>
                <th>{t('product.availability')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {product.offers.map((offer) => {
                const quantity = quantities[offer.offerId] ?? 1;
                const choices = Array.from({ length: Math.min(offer.stock, 10) }, (_, index) => index + 1);
                return (
                  <tr key={offer.offerId}>
                    <td>
                      <Link to={`/shop/stores/${offer.storeId}`} className="link">
                        <strong>{offer.storeName}</strong>
                      </Link>
                      <div className="muted small">{offer.storeAddress}</div>
                    </td>
                    <td className="price">{money(offer.priceCents)}</td>
                    <td>
                      {offer.stock > 0 ? (
                        <Badge tone="success">{t('product.left', { count: offer.stock })}</Badge>
                      ) : (
                        <Badge tone="danger">{t('shop.soldOut')}</Badge>
                      )}
                    </td>
                    <td className="right">
                      {isBuyer && offer.stock > 0 && (
                        <div className="row-actions">
                          <select
                            aria-label={t('product.quantity')}
                            value={quantity}
                            onChange={(event) =>
                              setQuantities((current) => ({ ...current, [offer.offerId]: Number(event.target.value) }))
                            }
                          >
                            {choices.map((choice) => (
                              <option key={choice} value={choice}>
                                {choice}
                              </option>
                            ))}
                          </select>
                          <button className="btn primary" onClick={() => addToCart(offer.offerId, quantity)}>
                            {t('product.addToCart')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {!user && <Notice tone="info">{t('product.signInHint')}</Notice>}
    </div>
  );
}
