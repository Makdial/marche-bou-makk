import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { HOME_PATH, useAuth } from '../auth';
import { LocationInput } from '../components/LocationInput';
import { Preferences } from '../components/Preferences';
import { roleLabel } from '../format';
import { useAction } from '../hooks';
import { useI18n } from '../i18n';
import { Badge, Card, Field, Notice } from '../ui';
import type { Point, Role } from '../../shared/types';

const DEMO_ACCOUNTS: { role: Role; email: string; password: string }[] = [
  { role: 'buyer', email: 'buyer@market.local', password: 'demo1234' },
  { role: 'vendor', email: 'vendor1@market.local', password: 'demo1234' },
  { role: 'conductor', email: 'conductor@market.local', password: 'demo1234' },
  { role: 'gp', email: 'gp@market.local', password: 'demo1234' },
  { role: 'admin', email: 'admin@market.local', password: 'admin1234' },
];

function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { t } = useI18n();
  return (
    <div className="auth-page">
      <div className="auth-column">
        <div className="auth-prefs">
          <Preferences />
        </div>
        <div className="brand big">
          <span className="logo">MB</span>
          <span>{t('app.name')}</span>
        </div>
        <Card className="auth-card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
        </Card>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const action = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (user) return <Navigate to={HOME_PATH[user.role]} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const me = await action.run(() => signIn(email.trim(), password));
    if (me) navigate(HOME_PATH[me.role], { replace: true });
  }

  return (
    <AuthShell title={t('auth.welcomeBack')} subtitle={t('auth.signInSub')}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('common.email')}>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('common.password')}>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <button className="btn primary block" disabled={action.busy}>
          {action.busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
      <p className="muted small center">
        {t('auth.newHere')} <Link to="/register">{t('auth.createAccount')}</Link>
      </p>
      <div className="demo-box">
        <span className="eyebrow">{t('auth.demoTitle')}</span>
        <div className="demo-grid">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="btn small"
              onClick={() => {
                setEmail(account.email);
                setPassword(account.password);
              }}
            >
              {roleLabel(account.role)}
            </button>
          ))}
        </div>
        <small className="muted">{t('auth.demoPasswords')}</small>
      </div>
    </AuthShell>
  );
}

type Draft = {
  name: string;
  email: string;
  password: string;
  phone: string;
  address: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeWebsite: string;
  storeOpenTime: string;
  storeCloseTime: string;
  description: string;
  vehicle: string;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  email: '',
  password: '',
  phone: '',
  address: '',
  storeName: '',
  storeAddress: '',
  storePhone: '',
  storeWebsite: '',
  storeOpenTime: '',
  storeCloseTime: '',
  description: '',
  vehicle: 'moto',
};

export function RegisterPage() {
  const { t } = useI18n();
  const { user, signUp } = useAuth();
  const navigate = useNavigate();
  const action = useAction();
  const [role, setRole] = useState<Role>('buyer');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [point, setPoint] = useState<Point | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (user) return <Navigate to={HOME_PATH[user.role]} replace />;

  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    if (role === 'vendor' && !point) {
      setLocalError(t('auth.setStoreLocation'));
      return;
    }
    const body: Record<string, unknown> = {
      role,
      name: draft.name.trim(),
      email: draft.email.trim(),
      password: draft.password,
      phone: draft.phone.trim() || undefined,
    };
    if (role === 'buyer') {
      body.address = draft.address.trim() || undefined;
      if (point) Object.assign(body, { lat: point.lat, lng: point.lng });
    }
    if (role === 'vendor' && point) {
      Object.assign(body, {
        storeName: draft.storeName.trim(),
        storeAddress: draft.storeAddress.trim(),
        storeLat: point.lat,
        storeLng: point.lng,
        storePhone: draft.storePhone.trim() || undefined,
        storeWebsite: draft.storeWebsite.trim() || undefined,
        storeOpenTime: draft.storeOpenTime.trim() || undefined,
        storeCloseTime: draft.storeCloseTime.trim() || undefined,
        description: draft.description.trim() || undefined,
      });
    }
    if (role === 'conductor') body.vehicle = draft.vehicle;
    const me = await action.run(() => signUp(body));
    if (me) navigate(HOME_PATH[me.role], { replace: true });
  }

  return (
    <AuthShell title={t('auth.createTitle')} subtitle={t('auth.createSub')}>
      <div className="tabs" role="tablist">
        {(['buyer', 'vendor', 'conductor', 'gp'] as Role[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={role === option}
            className={role === option ? 'tab active' : 'tab'}
            onClick={() => setRole(option)}
          >
            {option === 'buyer' ? t('auth.tabShopper') : option === 'vendor' ? t('auth.tabStore') : option === 'conductor' ? t('auth.tabConductor') : t('role.gp')}
          </button>
        ))}
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <Field label={t('auth.fullName')}>
            <input required minLength={2} value={draft.name} onChange={set('name')} />
          </Field>
          <Field label={t('common.phone')}>
            <input value={draft.phone} onChange={set('phone')} placeholder={t('auth.phonePlaceholder')} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t('common.email')}>
            <input type="email" required value={draft.email} onChange={set('email')} />
          </Field>
          <Field label={t('common.password')} hint={t('auth.passwordHint')}>
            <input type="password" required minLength={6} value={draft.password} onChange={set('password')} />
          </Field>
        </div>

        {role === 'buyer' && (
          <>
            <Field label={t('auth.defaultAddress')}>
              <input value={draft.address} onChange={set('address')} placeholder={t('auth.addressPlaceholder')} />
            </Field>
            <Field label={t('auth.defaultLocation')} hint={t('auth.defaultLocationHint')}>
              <LocationInput value={point} onChange={setPoint} />
            </Field>
          </>
        )}

        {role === 'vendor' && (
          <>
            <div className="grid-2">
              <Field label={t('auth.storeName')}>
                <input required minLength={2} value={draft.storeName} onChange={set('storeName')} />
              </Field>
              <Field label={t('auth.storePhone')}>
                <input value={draft.storePhone} onChange={set('storePhone')} placeholder={t('auth.phonePlaceholder')} />
              </Field>
              <Field label="Website">
                <input value={draft.storeWebsite} onChange={set('storeWebsite')} placeholder="https://..." />
              </Field>
              <Field label="Opening time">
                <input value={draft.storeOpenTime} onChange={set('storeOpenTime')} placeholder="08:00" />
              </Field>
              <Field label="Closing time">
                <input value={draft.storeCloseTime} onChange={set('storeCloseTime')} placeholder="22:00" />
              </Field>
            </div>
            <Field label={t('auth.storeAddress')}>
              <input required minLength={5} value={draft.storeAddress} onChange={set('storeAddress')} />
            </Field>
            <Field label={t('auth.storeLocation')} hint={t('auth.storeLocationHint')}>
              <LocationInput value={point} onChange={setPoint} />
            </Field>
            <Field label={t('auth.shortDescription')}>
              <textarea rows={2} value={draft.description} onChange={set('description')} />
            </Field>
          </>
        )}

        {role === 'conductor' && (
          <Field label={t('auth.vehicle')}>
            <select value={draft.vehicle} onChange={set('vehicle')}>
              <option value="moto">{t('vehicle.moto')}</option>
              <option value="bicycle">{t('vehicle.bicycle')}</option>
              <option value="car">{t('vehicle.car')}</option>
              <option value="van">{t('vehicle.van')}</option>
            </select>
          </Field>
        )}

        {role !== 'buyer' && (
          <Badge tone="warn">{role === 'vendor' ? t('auth.vendorReview') : t('auth.conductorReview')}</Badge>
        )}
        {(localError || action.error) && <Notice tone="danger">{localError ?? action.error}</Notice>}
        <button className="btn primary block" disabled={action.busy}>
          {action.busy ? t('auth.creating') : t('auth.createButton')}
        </button>
      </form>
      <p className="muted small center">
        {t('auth.alreadyRegistered')} <Link to="/login">{t('auth.signInLink')}</Link>
      </p>
    </AuthShell>
  );
}
