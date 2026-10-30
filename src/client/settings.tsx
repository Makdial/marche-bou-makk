import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useI18n } from './i18n';
import { formatMoney } from '../shared/format';
import type { PublicSettings } from '../shared/types';

interface SettingsValue {
  settings: PublicSettings | null;
  money: (cents: number) => string;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    api<{ settings: PublicSettings }>('/settings')
      .then((data) => setSettings(data.settings))
      .catch(() => undefined);
  }, []);

  const currency = settings?.currency ?? 'XOF';
  const money = useCallback((cents: number) => formatMoney(cents, currency, locale), [currency, locale]);
  const value = useMemo(() => ({ settings, money }), [settings, money]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}
