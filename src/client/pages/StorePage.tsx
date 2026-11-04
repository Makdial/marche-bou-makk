import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useApi } from '../hooks';
import { useSettings } from '../settings';
import { useI18n } from '../i18n';
import { Card, Empty, ErrorState, Loading, PageHeader, ProductImage } from '../ui';
import type { StoreProfile } from '../../shared/types';

export function StorePage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { money } = useSettings();
  const store = useApi(() => api<{ store: StoreProfile }>(`/stores/${id}`).then((data) => data.store), [id]);

  if (store.loading && !store.data) return <Loading />;
  if (store.error && !store.data) return <ErrorState message={store.error} />;
  if (!store.data) return null;
  const current = store.data;

  return (
    <div className="page store-page">
      <Link to="/shop" className="back">← {t('common.back')}</Link>
      {current.bannerUrl && (
        <div className="store-hero">
          <img src={current.bannerUrl} alt={current.name} />
        </div>
      )}
      <PageHeader title={current.name} subtitle={current.address} />
      {current.description && <p className="store-description">{current.description}</p>}

      <div className="store-meta">
        {current.openTime && current.closeTime && (
          <div className="store-meta-item">
            <span className="store-meta-label">{t('store.openingHours')}</span>
            <strong>{current.openTime} – {current.closeTime}</strong>
          </div>
        )}
        {current.phone && (
          <div className="store-meta-item">
            <span className="store-meta-label">{t('common.phone')}</span>
            <strong>{current.phone}</strong>
          </div>
        )}
        {current.website && (
          <div className="store-meta-item">
            <span className="store-meta-label">{t('store.website')}</span>
            <a className="store-website" href={current.website} target="_blank" rel="noreferrer">
              {current.website.replace(/^https?:\/\//, '')}
            </a>
          </div>
        )}
        <div className="store-meta-item">
          <span className="store-meta-label">{t('store.productsInStock')}</span>
          <strong>{current.productCount}</strong>
        </div>
      </div>

      <h3 className="section-title">{t('store.products')}</h3>
      {current.offers.length === 0 && <Empty title={t('store.empty')}>{t('store.empty')}</Empty>}
      <div className="grid-cards">
        {current.offers.map((offer) => (
          <Link key={offer.offerId} to={`/shop/products/${offer.productId}`} className="product-card">
            <ProductImage name={offer.productName} url={offer.imageUrl} />
            <div className="product-body">
              <h3>{offer.productName}</h3>
              {offer.description && <p className="muted small">{offer.description}</p>}
              <div className="price-row">
                <span className="price">{money(offer.priceCents)}</span>
                {offer.stock > 0 && <span className="stock-pill">{t('store.inStock', { count: offer.stock })}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
