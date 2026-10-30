import type { AuthUser } from './auth';
import { db, now, sql, tx, type Param } from './db';
import { HttpError } from './http';
import { pushEvent } from './notifications';
import type { ChatConversation, ChatEvent, ChatMessage, ChatPerson, Role, UserStatus } from '../shared/types';

const MAX_MESSAGE_LENGTH = 1000;
const THREAD_LIMIT = 100;
const CONTACT_LIMIT = 100;

const CHAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_a, user_b),
  CHECK(user_a < user_b)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  image_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(conversation_id, user_id)
);
`;

export function initChatTables(): void {
  db.exec(CHAT_SCHEMA);
  const cols = sql.all<{ name: string }>('PRAGMA table_info(messages)').map((c) => c.name);
  if (!cols.includes('image_url')) db.exec('ALTER TABLE messages ADD COLUMN image_url TEXT');
}

interface ConversationRow {
  id: number;
  user_a: number;
  user_b: number;
}

interface ConversationViewRow {
  id: number;
  updated_at: string;
  other_id: number;
  other_name: string;
  other_role: Role;
  other_phone: string | null;
  store_name: string | null;
  last_id: number | null;
  last_sender_id: number | null;
  last_body: string | null;
  last_image_url: string | null;
  last_created_at: string | null;
  unread: number;
}

interface MessageRow {
  id: number;
  conversation_id: number;
  sender_id: number;
  body: string;
  image_url: string | null;
  created_at: string;
}

interface PersonRow {
  id: number;
  name: string;
  role: Role;
  store_name: string | null;
  phone: string | null;
}

// The three placeholders are the caller's id: unread count, other participant and read pointer.
const CONVERSATION_SELECT = `SELECT c.id, c.updated_at,
    o.id AS other_id, o.name AS other_name, o.role AS other_role, o.phone AS other_phone, s.name AS store_name,
    m.id AS last_id, m.sender_id AS last_sender_id, m.body AS last_body, m.image_url AS last_image_url, m.created_at AS last_created_at,
    (SELECT COUNT(*) FROM messages u
      WHERE u.conversation_id = c.id AND u.sender_id <> ? AND u.id > COALESCE(r.last_read_message_id, 0)) AS unread
  FROM conversations c
  JOIN users o ON o.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
  LEFT JOIN stores s ON s.owner_id = o.id
  LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.user_id = ?
  LEFT JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)`;

function queryConversations(me: AuthUser, where: string, ...params: Param[]): ChatConversation[] {
  const rows = sql.all<ConversationViewRow>(
    `${CONVERSATION_SELECT} WHERE ${where} ORDER BY c.updated_at DESC, c.id DESC`,
    me.id,
    me.id,
    me.id,
    ...params,
  );
  return rows.map(toConversation);
}

function toConversation(row: ConversationViewRow): ChatConversation {
  return {
    id: row.id,
    other: { id: row.other_id, name: row.other_name, role: row.other_role, storeName: row.store_name, phone: row.other_phone },
    lastMessage:
      row.last_id === null
        ? null
        : {
            id: row.last_id,
            conversationId: row.id,
            senderId: row.last_sender_id!,
            body: row.last_body!,
            imageUrl: row.last_image_url ?? null,
            createdAt: row.last_created_at!,
          },
    unread: row.unread,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    imageUrl: row.image_url ?? null,
    createdAt: row.created_at,
  };
}

function toPerson(row: PersonRow): ChatPerson {
  return { id: row.id, name: row.name, role: row.role, storeName: row.store_name, phone: row.phone };
}

function conversationView(me: AuthUser, conversationId: number): ChatConversation {
  return queryConversations(me, 'c.id = ?', conversationId)[0];
}

function requireParticipant(me: AuthUser, conversationId: number): ConversationRow {
  const row = sql.get<ConversationRow>('SELECT id, user_a, user_b FROM conversations WHERE id = ?', conversationId);
  if (!row || (row.user_a !== me.id && row.user_b !== me.id)) throw new HttpError(404, 'err.conversationNotFound');
  return row;
}

function requireCanMessage(sender: AuthUser, recipientId: number): void {
  if (sender.status !== 'active') throw new HttpError(403, 'err.chatPending');
  const recipient = sql.get<{ status: UserStatus }>('SELECT status FROM users WHERE id = ?', recipientId);
  if (!recipient) throw new HttpError(404, 'err.userNotFound');
  if (recipient.status !== 'active') throw new HttpError(403, 'err.chatTargetInactive');
}

function cleanMessage(input: unknown): { body: string; imageUrl: string | null } {
  const obj = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const rawBody = typeof input === 'string' ? input : (typeof obj.body === 'string' ? obj.body : '');
  const body = rawBody.trim();
  const imageUrl = typeof obj.imageUrl === 'string' && obj.imageUrl.trim() ? obj.imageUrl.trim() : null;
  if (!body && !imageUrl) throw new HttpError(400, 'err.messageEmpty');
  if (body.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, 'err.messageTooLong', { max: MAX_MESSAGE_LENGTH });
  return { body, imageUrl };
}

export function listConversations(me: AuthUser): { conversations: ChatConversation[]; unreadTotal: number } {
  const conversations = queryConversations(me, 'c.user_a = ? OR c.user_b = ?', me.id, me.id);
  return { conversations, unreadTotal: conversations.reduce((total, item) => total + item.unread, 0) };
}

export function openConversation(me: AuthUser, userId: number): { conversation: ChatConversation; created: boolean } {
  if (userId === me.id) throw new HttpError(400, 'err.cannotMessageSelf');
  requireCanMessage(me, userId);
  const [userA, userB] = me.id < userId ? [me.id, userId] : [userId, me.id];
  const stamp = now();
  const info = sql.run(
    'INSERT OR IGNORE INTO conversations (user_a, user_b, created_at, updated_at) VALUES (?, ?, ?, ?)',
    userA,
    userB,
    stamp,
    stamp,
  );
  const row = sql.get<{ id: number }>('SELECT id FROM conversations WHERE user_a = ? AND user_b = ?', userA, userB);
  return { conversation: conversationView(me, row!.id), created: Number(info.changes) === 1 };
}

export function openThread(
  me: AuthUser,
  conversationId: number,
): { conversation: ChatConversation; messages: ChatMessage[] } {
  const row = requireParticipant(me, conversationId);
  const messages = sql
    .all<MessageRow>(
      `SELECT id, conversation_id, sender_id, body, image_url, created_at FROM (
         SELECT id, conversation_id, sender_id, body, image_url, created_at FROM messages
         WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id`,
      row.id,
      THREAD_LIMIT,
    )
    .map(toMessage);
  sql.run(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id) VALUES (?, ?, ?)
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)`,
    row.id,
    me.id,
    messages.at(-1)?.id ?? 0,
  );
  return { conversation: conversationView(me, row.id), messages };
}

export function sendMessage(me: AuthUser, conversationId: number, input: unknown): ChatMessage {
  const row = requireParticipant(me, conversationId);
  const recipientId = row.user_a === me.id ? row.user_b : row.user_a;
  requireCanMessage(me, recipientId);
  const { body, imageUrl } = cleanMessage(input);
  const stamp = now();
  const message = tx<ChatMessage>(() => {
    const info = sql.run(
      'INSERT INTO messages (conversation_id, sender_id, body, image_url, created_at) VALUES (?, ?, ?, ?, ?)',
      row.id,
      me.id,
      body,
      imageUrl,
      stamp,
    );
    sql.run('UPDATE conversations SET updated_at = ? WHERE id = ?', stamp, row.id);
    return { id: Number(info.lastInsertRowid), conversationId: row.id, senderId: me.id, body, imageUrl, createdAt: stamp };
  });
  const event: ChatEvent = { conversationId: row.id, messageId: message.id, senderId: me.id, senderName: me.name, body, imageUrl };
  pushEvent(me.id, 'chat', event);
  pushEvent(recipientId, 'chat', event);
  return message;
}

export function searchContacts(me: AuthUser, query: string): ChatPerson[] {
  const needle = query.toLowerCase();
  const rows = sql.all<PersonRow>(
    `SELECT u.id, u.name, u.role, s.name AS store_name, u.phone
     FROM users u LEFT JOIN stores s ON s.owner_id = u.id
     WHERE u.status = 'active' AND u.id <> ?
     ORDER BY u.name COLLATE NOCASE, u.id`,
    me.id,
  );
  return rows
    .filter((row) => row.name.toLowerCase().includes(needle) || (row.store_name ?? '').toLowerCase().includes(needle))
    .slice(0, CONTACT_LIMIT)
    .map(toPerson);
}
