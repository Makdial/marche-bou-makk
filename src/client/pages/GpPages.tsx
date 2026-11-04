import { useState, useEffect } from 'react';
import { api, uploadImage } from '../api';
import { useAuth } from '../auth';
import { useApi, useAction } from '../hooks';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';
import { LocationInput } from '../components/LocationInput';
import { Card, Empty, ErrorState, Loading, Notice, PageHeader } from '../ui';
import type { GpProfile, GpShipment, Point } from '../../shared/types';
import { COUNTRIES } from '../../shared/countries';
import type { TranslationKey } from '../../shared/i18n/en';

const GP_STATUS_KEY: Record<string, TranslationKey> = {
  registered: 'gp.status.registered',
  picked_up: 'gp.status.picked_up',
  delivered: 'gp.status.delivered',
};

export function GpPeoplePage() {
  const { t } = useI18n();
  const { money } = useSettings();
  const list = useApi(() => api<{ shipments: GpShipment[] }>('/gp/shipments').then((d) => d.shipments));
  return (
    <div className="page">
      <PageHeader title={t('gp.peopleTitle')} subtitle={t('gp.peopleSubtitle')} />
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorState message={list.error} />}
      {list.data && list.data.length === 0 && <Empty title={t('gp.noPeople')} />}
      {list.data && list.data.length > 0 && (
        <div className="grid-cards">
          {list.data.map((sh) => (
            <Card key={sh.id} title={sh.senderName}>
              {sh.photoUrl && <img src={sh.photoUrl} alt={sh.senderName} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />}
              <div className="muted small">{t('gp.sender')}: {sh.senderName} · {sh.senderPhone}</div>
              <div className="muted small">{t('gp.receiver')}: {sh.receiverName} · {sh.receiverPhone}</div>
              <div className="muted small">{t('gp.weight')}: {sh.weightKg} kg · {t('gp.price')}: {money(sh.priceCents)}</div>
              <div className="muted small">{t('gp.status')}: {t(GP_STATUS_KEY[sh.status] ?? 'gp.status.registered')}</div>
              <a className="link" href={`/gp?edit=${sh.id}`}>{t('common.edit')}</a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function GpDashboardPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { money } = useSettings();
  const search = new URLSearchParams(window.location.search);
  const editId = search.get('edit') ? Number(search.get('edit')) : null;
  const action = useAction();
  const profile = useApi(() => api<{ profile: GpProfile | null }>('/gp/profile').then((d) => d.profile));

  const [form, setForm] = useState({
    country: profile.data?.country ?? '',
    internationalPhone: profile.data?.internationalPhone ?? '',
    senegalPhone: profile.data?.senegalPhone ?? '',
    dropoffAddress: profile.data?.dropoffAddress ?? '',
  });
  const [point, setPoint] = useState<Point | null>(
    profile.data?.dropoffLat != null && profile.data?.dropoffLng != null
      ? { lat: profile.data.dropoffLat, lng: profile.data.dropoffLng }
      : null,
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile.data) return;
    setForm({
      country: profile.data.country ?? '',
      internationalPhone: profile.data.internationalPhone ?? '',
      senegalPhone: profile.data.senegalPhone ?? '',
      dropoffAddress: profile.data.dropoffAddress ?? '',
    });
    if (profile.data.dropoffLat != null && profile.data.dropoffLng != null) {
      setPoint({ lat: profile.data.dropoffLat, lng: profile.data.dropoffLng });
    }
  }, [profile.data]);

  async function save() {
    if (!point) return;
    const result = await action.run(() =>
      api('/gp/profile', {
        method: 'PUT',
        body: {
          country: form.country,
          internationalPhone: form.internationalPhone,
          senegalPhone: form.senegalPhone,
          dropoffAddress: form.dropoffAddress,
          dropoffLat: point.lat,
          dropoffLng: point.lng,
        },
      }),
    );
    if (result !== undefined) {
      setSaved(true);
      profile.reload();
    }
  }

  if (profile.loading && !profile.data && !profile.error) return <Loading />;
  if (profile.error) return <ErrorState message={profile.error} />;

  return (
    <div className="page">
      <PageHeader title={t('gp.title')} subtitle={t('gp.subtitle')} />
      <Notice tone="info">
        {t('gp.welcome', { name: user?.name ?? '' })}
      </Notice>
      <Card title={t('gp.profileTitle')}>
        <div className="stack">
          <label className="field">
            <span>{t('gp.countryResidence')}</span>
            <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              <option value="">{t('gp.choose')}</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('gp.internationalPhone')}</span>
            <input value={form.internationalPhone} onChange={(e) => setForm({ ...form, internationalPhone: e.target.value })} placeholder={t('auth.internationalPhonePlaceholder')} />
          </label>
          <label className="field">
            <span>{t('gp.senegalPhone')}</span>
            <input value={form.senegalPhone} onChange={(e) => setForm({ ...form, senegalPhone: e.target.value })} placeholder={t('auth.phonePlaceholder')} />
          </label>
          <label className="field">
            <span>{t('gp.dropoffAddress')}</span>
            <input value={form.dropoffAddress} onChange={(e) => setForm({ ...form, dropoffAddress: e.target.value })} placeholder={t('gp.dropoffPlaceholder')} />
          </label>
          <label className="field">
            <span>{t('gp.dropoffLocation')}</span>
            <LocationInput value={point} onChange={setPoint} />
          </label>
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          {saved && <Notice tone="success">{t('gp.profileSaved')}</Notice>}
          <div>
            <button className="btn primary" disabled={action.busy || !point} onClick={save}>
              {action.busy ? t('common.saving') : t('gp.saveProfile')}
            </button>
          </div>
        </div>
      </Card>
      <Card title={t('gp.howTitle')}>
        <ol className="steps-list">
          <li>{t('gp.howStep1')}</li>
          <li>{t('gp.howStep2')}</li>
          <li>{t('gp.howStep3')}</li>
        </ol>
      </Card>
      <GpShipments initialEditId={editId} />
    </div>
  );
}

function GpShipments({ initialEditId }: { initialEditId: number | null }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const action = useAction();
  const list = useApi(() => api<{ shipments: GpShipment[] }>('/gp/shipments').then((d) => d.shipments));
  const [form, setForm] = useState({
    senderName: '',
    senderPhone: '',
    receiverName: '',
    receiverPhone: '',
    weightKg: '',
    priceCents: '',
  });
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(initialEditId);
  useEffect(() => {
    if (!initialEditId || !list.data) return;
    const sh = list.data.find((s) => s.id === initialEditId);
    if (sh) editShipment(sh);
  }, [initialEditId, list.data]);

  async function create() {
    if (!form.senderName || !form.receiverName) return;
    const body = {
      senderName: form.senderName,
      senderPhone: form.senderPhone,
      receiverName: form.receiverName,
      receiverPhone: form.receiverPhone,
      photoUrl: photo,
      weightKg: Number(form.weightKg),
      priceCents: Number(form.priceCents),
    };
    const result = await action.run(() =>
      editingId
        ? api(`/gp/shipments/${editingId}`, { method: 'PUT', body })
        : api('/gp/shipments', { method: 'POST', body }),
    );
    if (result !== undefined) {
      setForm({ senderName: '', senderPhone: '', receiverName: '', receiverPhone: '', weightKg: '', priceCents: '' });
      setPhoto(null);
      setEditingId(null);
      list.reload();
    }
  }

  function editShipment(sh: GpShipment) {
    setEditingId(sh.id);
    setForm({
      senderName: sh.senderName,
      senderPhone: sh.senderPhone,
      receiverName: sh.receiverName,
      receiverPhone: sh.receiverPhone,
      weightKg: String(sh.weightKg),
      priceCents: String(sh.priceCents),
    });
    setPhoto(sh.photoUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function mark(id: number, status: 'picked_up' | 'delivered') {
    let proofPhotoUrl: string | undefined;
    if (status === 'delivered') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
      });
      if (file) {
        setUploading(true);
        try { proofPhotoUrl = await uploadImage(file); } catch { /* ignore */ }
        finally { setUploading(false); }
      }
    }
    const result = await action.run(() => api(`/gp/shipments/${id}`, { method: 'PATCH', body: { status, proofPhotoUrl } }));
    if (result !== undefined) list.reload();
  }

  async function remove(id: number) {
    if (!window.confirm(t('gp.removeConfirm'))) return;
    const result = await action.run(() => api(`/gp/shipments/${id}`, { method: 'DELETE' }));
    if (result !== undefined) list.reload();
  }

  return (
    <div className="page">
      <h3 className="section-title">{t('gp.registeredPackages')}</h3>
      <Card title={editingId ? t('gp.editPackage') : t('gp.addPackage')}>
        <div className="stack">
          <div className="grid-2">
            <label className="field"><span>{t('gp.senderName')}</span><input value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} /></label>
            <label className="field"><span>{t('gp.senderPhone')}</span><input value={form.senderPhone} onChange={(e) => setForm({ ...form, senderPhone: e.target.value })} /></label>
            <label className="field"><span>{t('gp.receiverName')}</span><input value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} /></label>
            <label className="field"><span>{t('gp.receiverPhone')}</span><input value={form.receiverPhone} onChange={(e) => setForm({ ...form, receiverPhone: e.target.value })} /></label>
            <label className="field"><span>{t('gp.weightKg')}</span><input type="number" step="0.1" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} /></label>
            <label className="field"><span>{t('gp.priceFcfa')}</span><input type="number" value={form.priceCents} onChange={(e) => setForm({ ...form, priceCents: e.target.value })} /></label>
          </div>
          <label className="field">
            <span>{t('gp.packagePhoto')}</span>
            <input type="file" accept="image/*" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try { setPhoto(await uploadImage(f)); } catch { /* ignore */ }
              finally { setUploading(false); }
            }} />
            {photo && <img src={photo} alt={t('gp.packageAlt')} style={{ maxHeight: 80, borderRadius: 6, marginTop: 6 }} />}
          </label>
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          <div className="row-gap">
            <button className="btn primary" disabled={action.busy || uploading} onClick={create}>
              {editingId ? t('gp.saveChanges') : t('gp.registerPackage')}
            </button>
            {editingId && (
              <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ senderName: '', senderPhone: '', receiverName: '', receiverPhone: '', weightKg: '', priceCents: '' }); setPhoto(null); }}>
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card title={t('gp.packages')}>
        {list.loading && !list.data && <Loading />}
        {list.error && <ErrorState message={list.error} />}
        {list.data && list.data.length === 0 && <Empty title={t('gp.noPackages')} />}
        {list.data && list.data.length > 0 && (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('gp.photo')}</th>
                  <th>{t('gp.sender')}</th>
                  <th>{t('gp.receiverName')}</th>
                  <th>{t('gp.weight')}</th>
                  <th>{t('gp.price')}</th>
                  <th>{t('gp.status')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((sh) => (
                  <tr key={sh.id} style={{ cursor: 'pointer' }} onClick={() => editShipment(sh)}>
                    <td>{sh.photoUrl ? <img src={sh.photoUrl} alt={t('gp.packageAlt')} style={{ height: 40, borderRadius: 4 }} /> : '—'}</td>
                    <td>{sh.senderName}<br /><span className="muted small">{sh.senderPhone}</span></td>
                    <td>{sh.receiverName}<br /><span className="muted small">{sh.receiverPhone}</span></td>
                    <td>{sh.weightKg} kg</td>
                    <td>{money(sh.priceCents)}</td>
                    <td>{t(GP_STATUS_KEY[sh.status] ?? 'gp.status.registered')}{sh.proofPhotoUrl ? <><br /><img src={sh.proofPhotoUrl} alt={t('gp.proofAlt')} style={{ height: 32, borderRadius: 4 }} /></> : null}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {sh.status === 'registered' && <button className="btn small" disabled={action.busy} onClick={() => mark(sh.id, 'picked_up')}>{t('gp.markPickedUp')}</button>}
                      {sh.status === 'picked_up' && <button className="btn small primary" disabled={action.busy || uploading} onClick={() => mark(sh.id, 'delivered')}>{t('gp.markDelivered')}</button>}
                      <button className="btn small danger" disabled={action.busy} onClick={() => remove(sh.id)}>{t('common.remove')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">{t('gp.clickRow')}</p>
          </>
        )}
      </Card>
    </div>
  );
}

