import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Marker, Popup, Tooltip } from 'react-leaflet';
import { api } from '../api';
import { FitBounds, MapCanvas, pinIcon } from '../components/MapView';
import { categoryLabel, mapsUrl } from '../format';
import { useApi, useDebounced } from '../hooks';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { Badge, Card, Empty, ErrorState, Loading, PageHeader, ProductImage } from '../ui';
import type { Category, ProductSummary, PublicGp, PublicStore } from '../../shared/types';

export function ShopPage() {
  const { t } = useI18n();
  const { money } = useSettings();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('name');
  const debouncedQuery = useDebounced(query, 300);

  const categories = useApi(() => api<{ categories: Category[] }>('/categories').then((data) => data.categories));
  const stores = useApi(() => api<{ stores: PublicStore[] }>('/map/stores').then((data) => data.stores));
  const gps = useApi(() => api<{ gps: PublicGp[] }>('/map/gp').then((data) => data.gps));
  const products = useApi(
    () => {
      const params = new URLSearchParams({ sort });
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
      if (categoryId) params.set('categoryId', categoryId);
      return api<{ products: ProductSummary[] }>(`/products?${params}`).then((data) => data.products);
    },
    [debouncedQuery, categoryId, sort],
  );

  const storePoints = (stores.data ?? []).map((store) => ({ lat: store.lat, lng: store.lng }));

  return (
    <div className="page">
      <PageHeader title={t('shop.title')} subtitle={t('shop.subtitle')} />

      <Card
        title={t('map.storesOnMap')}
        actions={<span className="muted small">{t('shop.storeCount', { count: stores.data?.length ?? 0 })}</span>}
      >
        {stores.error && <ErrorState message={stores.error} />}
        {stores.data && (
          <MapCanvas>
            <FitBounds points={storePoints} />
            {stores.data.map((store) => (
              <Marker
                key={store.id}
                position={[store.lat, store.lng]}
                icon={pinIcon('store', '🏪')}
                eventHandlers={{ click: () => navigate(`/shop/stores/${store.id}`) }}
              >
                <Tooltip direction="top" offset={[0, -12]} opacity={0.95}>
                  <strong>{store.name}</strong>
                  <br />
                  {store.address}
                </Tooltip>
                <Popup>
                  <strong>{store.name}</strong>
                  <br />
                  {store.address}
                  <br />
                  {t('map.productsInStock', { count: store.productCount })}
                  {store.openTime && store.closeTime && (
                    <>
                      <br />
                      {store.openTime} – {store.closeTime}
                    </>
                  )}
                  <br />
                  <Link to={`/shop/stores/${store.id}`}>{t('store.visit')}</Link>
                  {' · '}
                  <a href={mapsUrl(store.lat, store.lng)} target="_blank" rel="noreferrer">
                    {t('order.openMaps')}
                  </a>
                </Popup>
              </Marker>
            ))}
            {gps.data?.map((gp) => (
              <Marker key={`gp-${gp.id}`} position={[gp.lat, gp.lng]} icon={pinIcon('conductor', '🌍')}>
                <Tooltip direction="top" offset={[0, -12]} opacity={0.95}>
                  <strong>{gp.name}</strong>
                  <br />
                  {gp.country}
                  <br />
                  {gp.address}
                </Tooltip>
                <Popup>
                  <strong>{gp.name}</strong>
                  <br />
                  {gp.country && <>{t('shop.fromCountry', { country: gp.country })}<br /></>}
                  {gp.address && <>{gp.address}<br /></>}
                  <span className="muted small">{t('shop.gpDropoff')}</span>
                </Popup>
              </Marker>
            ))}
          </MapCanvas>
        )}
      </Card>

      <div className="toolbar">
        <input
          className="grow"
          placeholder={t('shop.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">{t('shop.allCategories')}</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {categoryLabel(category.name)}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="name">{t('shop.sortName')}</option>
          <option value="price_asc">{t('shop.sortAsc')}</option>
          <option value="price_desc">{t('shop.sortDesc')}</option>
        </select>
      </div>

      {products.loading && !products.data && <Loading />}
      {products.error && <ErrorState message={products.error} />}
      {products.data && products.data.length === 0 && (
        <Empty title={t('shop.noMatch')}>{t('shop.noMatchHint')}</Empty>
      )}

      <div className="grid-cards">
        {products.data?.map((product) => (
          <Link key={product.id} to={`/shop/products/${product.id}`} className="product-card">
            <ProductImage name={product.name} url={product.imageUrl} />
            <div className="product-body">
              <span className="muted small">
                {product.categoryName ? categoryLabel(product.categoryName) : t('shop.uncategorized')}
              </span>
              <h3>{product.name}</h3>
              <div className="price-row">
                <span className="price">{t('shop.fromPrice', { price: money(product.minPriceCents) })}</span>
                <span className="muted small">{t('shop.storeCount', { count: product.offerCount })}</span>
              </div>
              {product.inStockOffers === 0 ? (
                <Badge tone="danger">{t('shop.soldOut')}</Badge>
              ) : (
                <Badge tone="success">{t('shop.inStock')}</Badge>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
