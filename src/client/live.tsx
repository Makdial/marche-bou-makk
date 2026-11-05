import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken } from './api';
import { useAuth } from './auth';
import { renderMessage, tr } from './i18n';
import { playSound, unlockSound } from './sound';
import type { ChatEvent, NotificationItem } from '../shared/types';

export interface Toast {
  id: number;
  title: string;
  body: string;
  to: string;
}

interface LiveValue {
  tick: number;
  chatTick: number;
  unread: number;
  chatUnread: number;
  setUnread: (count: number) => void;
  refreshChat: () => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  connected: boolean;
}

const LiveContext = createContext<LiveValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  const [chatTick, setChatTick] = useState(0);
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connected, setConnected] = useState(false);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const refreshChat = useCallback(() => {
    if (!user) return;
    api<{ unreadTotal: number }>('/messages/conversations')
      .then((data) => setChatUnread(data.unreadTotal))
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      setChatUnread(0);
      setConnected(false);
      return;
    }

    let source: EventSource | null = null;
    let retry: number | undefined;
    let closed = false;
    let nextId = 1;

    api<{ unreadCount: number }>('/notifications?limit=1')
      .then((data) => setUnread(data.unreadCount))
      .catch(() => undefined);
    refreshChat();

    const addToast = (title: string, body: string, to: string) => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-2), { id, title, body, to }]);
      window.setTimeout(() => dismissToast(id), 6000);
    };

    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      source = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
      source.onopen = () => setConnected(true);
      source.addEventListener('notification', (event: Event) => {
        const item = JSON.parse((event as MessageEvent<string>).data) as NotificationItem;
        const title = renderMessage(item.titleKey, item.params, item.title);
        const body = renderMessage(item.bodyKey, item.params, item.body);
        setTick((value) => value + 1);
        setUnread((count) => count + 1);
        playSound('notification');
        addToast(title, body, typeof item.data.orderId === 'number' ? `/orders/${item.data.orderId}` : '/notifications');
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
          new Notification(title, { body });
        }
      });
      source.addEventListener('chat', (event: Event) => {
        const item = JSON.parse((event as MessageEvent<string>).data) as ChatEvent;
        setChatTick((value) => value + 1);
        refreshChat();
        if (item.senderId !== user.id) {
          playSound('message');
          addToast(tr('chat.newFrom', { name: item.senderName }), item.body.slice(0, 120), '/messages');
        }
      });
      source.addEventListener('location', () => {
        // A conductor moved: refresh maps and order views.
        setTick((value) => value + 1);
      });
      source.addEventListener('call', (event: Event) => {
        const item = JSON.parse((event as MessageEvent<string>).data);
        playSound('call');
        window.dispatchEvent(new CustomEvent('mbm:call', { detail: item }));
      });
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!closed) retry = window.setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      closed = true;
      setConnected(false);
      source?.close();
      window.clearTimeout(retry);
    };
  }, [user, dismissToast, refreshChat]);

  const value = useMemo(
    () => ({ tick, chatTick, unread, chatUnread, setUnread, refreshChat, toasts, dismissToast, connected }),
    [tick, chatTick, unread, chatUnread, refreshChat, toasts, dismissToast, connected],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive must be used inside LiveProvider');
  return value;
}
