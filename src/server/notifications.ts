import type { Response } from 'express';
import { translate, type Params } from '../shared/i18n';
import type { TranslationKey } from '../shared/i18n/en';
import type { NotificationItem } from '../shared/types';
import { now, placeholders, sql } from './db';

const streams = new Map<number, Set<Response>>();

export function openStream(userId: number, res: Response): () => void {
  const sockets = streams.get(userId) ?? new Set<Response>();
  sockets.add(res);
  streams.set(userId, sockets);
  return () => {
    sockets.delete(res);
    if (sockets.size === 0) streams.delete(userId);
  };
}

export interface NotifyInput {
  type: string;
  titleKey?: TranslationKey;
  bodyKey?: TranslationKey;
  params?: Params;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

export function notify(userIds: Iterable<number>, input: NotifyInput): void {
  const params = input.params ?? {};
  const keyed = input.titleKey !== undefined || input.bodyKey !== undefined;
  const title = input.titleKey ? translate('en', input.titleKey, params) : (input.title ?? '');
  const body = input.bodyKey ? translate('en', input.bodyKey, params) : (input.body ?? '');
  const data = keyed
    ? { ...input.data, i18n: { titleKey: input.titleKey ?? null, bodyKey: input.bodyKey ?? null, params } }
    : (input.data ?? {});
  const stored = JSON.stringify(data);
  for (const userId of new Set(userIds)) {
    const createdAt = now();
    const info = sql.run(
      'INSERT INTO notifications (user_id, type, title, body, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      userId,
      input.type,
      title,
      body,
      stored,
      createdAt,
    );
    const item = toItem({
      id: Number(info.lastInsertRowid),
      type: input.type,
      title,
      body,
      data: stored,
      read_at: null,
      created_at: createdAt,
    });
    const sockets = streams.get(userId);
    if (sockets) {
      const chunk = `event: notification\ndata: ${JSON.stringify(item)}\n\n`;
      for (const res of sockets) res.write(chunk);
    }
  }
}

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string;
  data: string | null;
  read_at: string | null;
  created_at: string;
}

function unreadCount(userId: number): number {
  return sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)?.n ?? 0;
}

interface StoredI18n {
  titleKey: string | null;
  bodyKey: string | null;
  params: Params;
}

function toItem(row: NotificationRow): NotificationItem {
  const { i18n, ...data }: Record<string, unknown> & { i18n?: StoredI18n } = row.data ? JSON.parse(row.data) : {};
  return {
    id: row.id,
    type: row.type,
    titleKey: i18n?.titleKey ?? null,
    bodyKey: i18n?.bodyKey ?? null,
    params: i18n?.params ?? {},
    title: row.title,
    body: row.body,
    data,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function listNotifications(userId: number, limit = 50): { notifications: NotificationItem[]; unreadCount: number } {
  const rows = sql.all<NotificationRow>(
    'SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    userId,
    limit,
  );
  return {
    notifications: rows.map((row) => toItem(row)),
    unreadCount: unreadCount(userId),
  };
}

export function pushEvent(userId: number, event: string, data: unknown): void {
  const sockets = streams.get(userId);
  if (!sockets) return;
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sockets) res.write(chunk);
}

export function markRead(userId: number, ids?: number[]): number {
  const stamp = now();
  if (!ids) {
    sql.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', stamp, userId);
  } else if (ids.length > 0) {
    sql.run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders(ids.length)})`,
      stamp,
      userId,
      ...ids,
    );
  }
  return unreadCount(userId);
}
