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


export function GpPeoplePage() {
  const { t } = useI18n();
  const { money } = useSettings();
  const list = useApi(() => api<{ shipments: GpShipment[] }>('/gp/shipments').then((d) => d.shipments));
  return (
    <div className="page">
      <PageHeader title="People" subtitle="Everyone registered for international transport." />
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorState message={list.error} />}
      {list.data && list.data.length === 0 && <Empty title="No people yet" />}
      {list.data && list.data.length > 0 && (
        <div className="grid-cards">
          {list.data.map((sh) => (
            <Card key={sh.id} title={sh.senderName}>
              {sh.photoUrl && <img src={sh.photoUrl} alt={sh.senderName} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />}
              <div className="muted small">Sender: {sh.senderName} · {sh.senderPhone}</div>
              <div className="muted small">Receiver: {sh.receiverName} · {sh.receiverPhone}</div>
              <div className="muted small">Weight: {sh.weightKg} kg · Price: {money(sh.priceCents)}</div>
              <div className="muted small">Status: {sh.status}</div>
              <a className="link" href={`/gp?edit=${sh.id}`}>Edit</a>
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
      <PageHeader title="International GP" subtitle="Your country, phone numbers and Senegal drop-off location." />
      <Notice tone="info">
        Welcome, {user?.name}. International GP accounts are reviewed by an admin before going live.
      </Notice>
      <Card title="Your profile">
        <div className="stack">
          <label className="field">
            <span>Country of residence</span>
            <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              <option value="">Choose…</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>International phone number</span>
            <input value={form.internationalPhone} onChange={(e) => setForm({ ...form, internationalPhone: e.target.value })} placeholder="+1 555 000 0000" />
          </label>
          <label className="field">
            <span>Senegal phone number (+221)</span>
            <input value={form.senegalPhone} onChange={(e) => setForm({ ...form, senegalPhone: e.target.value })} placeholder="+221 77 000 00 00" />
          </label>
          <label className="field">
            <span>Senegal drop-off address (where people pick up)</span>
            <input value={form.dropoffAddress} onChange={(e) => setForm({ ...form, dropoffAddress: e.target.value })} placeholder="Dakar, Senegal" />
          </label>
          <label className="field">
            <span>Drop-off location on map</span>
            <LocationInput value={point} onChange={setPoint} />
          </label>
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          {saved && <Notice tone="success">Profile saved.</Notice>}
          <div>
            <button className="btn primary" disabled={action.busy || !point} onClick={save}>
              {action.busy ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </Card>
      <Card title="How it works">
        <ol className="steps-list">
          <li>Choose your country of residence and enter both your international and Senegal phone numbers.</li>
          <li>Set the Senegal address and map location where people will come to pick up packages sent from your country.</li>
          <li>Once approved, people in Senegal can reach you through the app to collect their packages.</li>
        </ol>
      </Card>
      <GpShipments initialEditId={editId} />
    </div>
  );
}

function GpShipments({ initialEditId }: { initialEditId: number | null }) {
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
    if (!window.confirm('Remove this shipment?')) return;
    const result = await action.run(() => api(`/gp/shipments/${id}`, { method: 'DELETE' }));
    if (result !== undefined) list.reload();
  }

  return (
    <div className="page">
      <h3 className="section-title">Registered packages</h3>
      <Card title={editingId ? 'Edit package' : 'Add a package'}>
        <div className="stack">
          <div className="grid-2">
            <label className="field"><span>Sender name</span><input value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} /></label>
            <label className="field"><span>Sender phone</span><input value={form.senderPhone} onChange={(e) => setForm({ ...form, senderPhone: e.target.value })} /></label>
            <label className="field"><span>Receiver name (Senegal)</span><input value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} /></label>
            <label className="field"><span>Receiver phone (Senegal)</span><input value={form.receiverPhone} onChange={(e) => setForm({ ...form, receiverPhone: e.target.value })} /></label>
            <label className="field"><span>Weight (kg)</span><input type="number" step="0.1" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} /></label>
            <label className="field"><span>Price (FCFA)</span><input type="number" value={form.priceCents} onChange={(e) => setForm({ ...form, priceCents: e.target.value })} /></label>
          </div>
          <label className="field">
            <span>Photo of package</span>
            <input type="file" accept="image/*" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try { setPhoto(await uploadImage(f)); } catch { /* ignore */ }
              finally { setUploading(false); }
            }} />
            {photo && <img src={photo} alt="package" style={{ maxHeight: 80, borderRadius: 6, marginTop: 6 }} />}
          </label>
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          <div className="row-gap">
            <button className="btn primary" disabled={action.busy || uploading} onClick={create}>
              {editingId ? 'Save changes' : 'Register package'}
            </button>
            {editingId && (
              <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ senderName: '', senderPhone: '', receiverName: '', receiverPhone: '', weightKg: '', priceCents: '' }); setPhoto(null); }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card title="Packages">
        {list.loading && !list.data && <Loading />}
        {list.error && <ErrorState message={list.error} />}
        {list.data && list.data.length === 0 && <Empty title="No packages yet" />}
        {list.data && list.data.length > 0 && (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Sender</th>
                  <th>Receiver (Senegal)</th>
                  <th>Weight</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((sh) => (
                  <tr key={sh.id} style={{ cursor: 'pointer' }} onClick={() => editShipment(sh)}>
                    <td>{sh.photoUrl ? <img src={sh.photoUrl} alt="package" style={{ height: 40, borderRadius: 4 }} /> : '—'}</td>
                    <td>{sh.senderName}<br /><span className="muted small">{sh.senderPhone}</span></td>
                    <td>{sh.receiverName}<br /><span className="muted small">{sh.receiverPhone}</span></td>
                    <td>{sh.weightKg} kg</td>
                    <td>{money(sh.priceCents)}</td>
                    <td>{sh.status}{sh.proofPhotoUrl ? <><br /><img src={sh.proofPhotoUrl} alt="proof" style={{ height: 32, borderRadius: 4 }} /></> : null}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {sh.status === 'registered' && <button className="btn small" disabled={action.busy} onClick={() => mark(sh.id, 'picked_up')}>Mark picked up</button>}
                      {sh.status === 'picked_up' && <button className="btn small primary" disabled={action.busy || uploading} onClick={() => mark(sh.id, 'delivered')}>Mark delivered (photo)</button>}
                      <button className="btn small danger" disabled={action.busy} onClick={() => remove(sh.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Click a row to edit that package.</p>
          </>
        )}
      </Card>
    </div>
  );
}

