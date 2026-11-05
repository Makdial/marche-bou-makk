import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { OrderStatus } from '../shared/types';
import { statusLabel, statusTone, type Tone } from './format';
import { useI18n } from './i18n';

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  to?: string;
}) {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  if (to) return <Link to={to} className={`stat ${tone} stat-link`}>{content}</Link>;
  return <div className={`stat ${tone}`}>{content}</div>;
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  // Re-renders on language change, since statusLabel reads the active locale directly.
  useI18n();
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading">
      <span className="spinner" aria-hidden="true" />
      {t('common.loading')}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <Notice tone="danger">{message}</Notice>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function ProductImage({ name, url, size = 'md' }: { name: string; url: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (url) return <img className={`product-img ${size}`} src={url} alt={name} />;
  const words = name.replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(Boolean);
  const initials = (
    words.length > 1 ? words.slice(0, 2).map((word) => word.charAt(0)).join('') : (words[0] ?? name).slice(0, 2)
  ).toUpperCase();
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const style: CSSProperties = {
    background: `linear-gradient(135deg, hsl(${hue} 70% 86%), hsl(${(hue + 40) % 360} 65% 72%))`,
  };
  return (
    <div className={`product-img ${size} placeholder`} style={style} aria-label={name}>
      {initials}
    </div>
  );
}
