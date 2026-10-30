import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { after, before, describe, it } from 'node:test';
import { en } from '../src/shared/i18n/en';
import { pickLocale } from '../src/shared/locale';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marche-chat-test-'));
process.env.SEED_DEMO = 'true';
process.env.NODE_ENV = 'test';

const { initDatabase } = await import('../src/server/seed');
const { initChatTables } = await import('../src/server/chat');
const { errorHandler } = await import('../src/server/http');
const { adminRouter } = await import('../src/server/routes/admin');
const { authRouter } = await import('../src/server/routes/auth');
const { chatRouter } = await import('../src/server/routes/chat');
const { notificationsRouter } = await import('../src/server/routes/notifications');

interface Response {
  status: number;
  data: any;
}

interface Session {
  token: string;
  id: number;
  name: string;
}

let server: Server;
let base = '';

// Mounts the same routers as app.ts, so these tests do not depend on how app.ts is wired.
function createTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, _res, next) => {
    req.locale = pickLocale(req.header('x-locale'));
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/messages', chatRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use(errorHandler);
  return app;
}

async function api(method: string, route: string, options: { token?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(email: string, password = 'demo1234'): Promise<Session> {
  const res = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return { token: res.data.token, id: res.data.user.id, name: res.data.user.name };
}

function expectError(res: Response, status: number, key: keyof typeof en, max?: number): void {
  assert.equal(res.status, status, JSON.stringify(res.data));
  assert.equal(res.data.error, max === undefined ? en[key] : en[key].replace('{max}', String(max)));
}

async function send(session: Session, conversationId: number, body: string): Promise<any> {
  const res = await api('POST', `/api/messages/conversations/${conversationId}/messages`, {
    token: session.token,
    body: { body },
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.message;
}

async function inboxOf(session: Session): Promise<any> {
  const res = await api('GET', '/api/messages/conversations', { token: session.token });
  assert.equal(res.status, 200);
  return res.data;
}

async function unreadIn(session: Session, conversationId: number): Promise<number> {
  const inbox = await inboxOf(session);
  return inbox.conversations.find((item: any) => item.id === conversationId).unread;
}

async function openStream(token: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/notifications/stream?token=${token}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        received += decoder.decode(value, { stream: true });
      }
    } catch {
      // Closed by close() below.
    }
  })();
  return {
    async waitFor(text: string): Promise<boolean> {
      const deadline = Date.now() + 5000;
      while (!received.includes(text) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return received.includes(text);
    },
    close: () => controller.abort(),
  };
}

before(async () => {
  initDatabase();
  initChatTables();
  server = createTestApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('direct messages', () => {
  let awa: Session;
  let mamadou: Session;
  let moussa: Session;
  let aminata: Session;
  let admin: Session;
  let ibrahima: Session;
  let conversationId: number;

  before(async () => {
    awa = await login('buyer@market.local');
    mamadou = await login('vendor1@market.local');
    moussa = await login('buyer2@market.local');
    aminata = await login('conductor2@market.local');
    admin = await login('admin@market.local', 'admin1234');
    ibrahima = await login('vendor3@market.local');
  });

  it('opens a conversation and lets both sides write back', async () => {
    const created = await api('POST', '/api/messages/conversations', { token: awa.token, body: { userId: mamadou.id } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const { conversation } = created.data;
    assert.equal(conversation.other.id, mamadou.id);
    assert.equal(conversation.other.name, 'Mamadou Ndiaye');
    assert.equal(conversation.other.storeName, 'Boulangerie Teranga');
    assert.equal(conversation.lastMessage, null);
    conversationId = conversation.id;

    const reopened = await api('POST', '/api/messages/conversations', { token: mamadou.token, body: { userId: awa.id } });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.conversation.id, conversationId, 'both sides share one conversation');

    const question = await send(awa, conversationId, 'Bonjour, vous avez encore des baguettes ?');
    assert.equal(question.senderId, awa.id);
    await send(mamadou, conversationId, 'Oui, fraîches ce matin.');

    const thread = await api('GET', `/api/messages/conversations/${conversationId}`, { token: awa.token });
    assert.equal(thread.status, 200);
    assert.deepEqual(
      thread.data.messages.map((message: any) => message.body),
      ['Bonjour, vous avez encore des baguettes ?', 'Oui, fraîches ce matin.'],
    );
    assert.equal(thread.data.messages[1].senderId, mamadou.id);

    const inbox = await inboxOf(mamadou);
    assert.equal(inbox.conversations[0].lastMessage.body, 'Oui, fraîches ce matin.');
  });

  it('counts unread messages for the recipient until the thread is opened', async () => {
    assert.equal(await unreadIn(mamadou, conversationId), 1, 'the first message is waiting for Mamadou');
    assert.equal(await unreadIn(awa, conversationId), 0);

    await send(awa, conversationId, 'Vous livrez à Ouakam ?');
    await send(awa, conversationId, 'Merci d’avance.');
    assert.equal(await unreadIn(mamadou, conversationId), 3);
    assert.equal(await unreadIn(awa, conversationId), 0, 'your own messages are never unread');

    const opened = await api('GET', `/api/messages/conversations/${conversationId}`, { token: mamadou.token });
    assert.equal(opened.data.conversation.unread, 0);
    assert.equal(opened.data.messages.length, 4);
    assert.equal((await inboxOf(mamadou)).unreadTotal, 0);

    await send(mamadou, conversationId, 'Oui, dans l’heure.');
    assert.equal(await unreadIn(awa, conversationId), 1);
    assert.equal((await inboxOf(awa)).unreadTotal, 1);
  });

  it('hides a conversation from everyone who is not in it', async () => {
    const threadRoute = `/api/messages/conversations/${conversationId}`;
    expectError(await api('GET', threadRoute, { token: moussa.token }), 404, 'err.conversationNotFound');
    expectError(
      await api('POST', `${threadRoute}/messages`, { token: moussa.token, body: { body: 'Salut' } }),
      404,
      'err.conversationNotFound',
    );
    expectError(await api('GET', threadRoute, { token: admin.token }), 404, 'err.conversationNotFound');
    const inbox = await inboxOf(moussa);
    assert.equal(inbox.conversations.some((item: any) => item.id === conversationId), false);
  });

  it('lets the admin message a buyer like any other approved account', async () => {
    const opened = await api('POST', '/api/messages/conversations', { token: admin.token, body: { userId: awa.id } });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    assert.equal(opened.data.conversation.other.name, 'Awa Diallo');
    const adminConversation = opened.data.conversation.id;
    await send(admin, adminConversation, 'Bienvenue sur la messagerie de Marche Bou Makk.');

    const inbox = await inboxOf(awa);
    assert.equal(inbox.conversations[0].id, adminConversation, 'the newest conversation comes first');
    assert.equal(inbox.conversations[0].other.name, 'Marche Bou Makk Admin');
    assert.equal(inbox.conversations[0].other.role, 'admin');
    assert.equal(inbox.conversations[0].unread, 1);
    assert.equal(inbox.unreadTotal, 2);
  });

  it('stops a pending vendor from starting a conversation, but lets them read', async () => {
    expectError(
      await api('POST', '/api/messages/conversations', { token: ibrahima.token, body: { userId: awa.id } }),
      403,
      'err.chatPending',
    );
    const inbox = await api('GET', '/api/messages/conversations', { token: ibrahima.token });
    assert.equal(inbox.status, 200);
    assert.deepEqual(inbox.data.conversations, []);
  });

  it('refuses to start a conversation with a pending account', async () => {
    expectError(
      await api('POST', '/api/messages/conversations', { token: awa.token, body: { userId: ibrahima.id } }),
      403,
      'err.chatTargetInactive',
    );
  });

  it('pushes new messages live to both participants', async () => {
    const buyerStream = await openStream(awa.token);
    const vendorStream = await openStream(mamadou.token);
    try {
      const message = await send(mamadou, conversationId, 'Vous êtes où ?');
      const frame = `event: chat\ndata: {"conversationId":${conversationId},"messageId":${message.id},`;
      assert.ok(await buyerStream.waitFor(frame), 'the buyer should receive the message live');
      assert.ok(await vendorStream.waitFor(frame), 'the sender should see it on their other open screens');
    } finally {
      buyerStream.close();
      vendorStream.close();
    }
  });

  it('rejects empty and overlong messages and trims the rest', async () => {
    const messagesRoute = `/api/messages/conversations/${conversationId}/messages`;
    expectError(await api('POST', messagesRoute, { token: awa.token, body: { body: '   ' } }), 400, 'err.messageEmpty');
    expectError(await api('POST', messagesRoute, { token: awa.token, body: {} }), 400, 'err.messageEmpty');
    expectError(
      await api('POST', messagesRoute, { token: awa.token, body: { body: 'a'.repeat(1001) } }),
      400,
      'err.messageTooLong',
      1000,
    );
    assert.equal((await send(awa, conversationId, 'a'.repeat(1000))).body.length, 1000);
    assert.equal((await send(awa, conversationId, '  Merci  ')).body, 'Merci');
  });

  it('rejects self-chats, unknown users and malformed ids', async () => {
    expectError(
      await api('POST', '/api/messages/conversations', { token: awa.token, body: { userId: awa.id } }),
      400,
      'err.cannotMessageSelf',
    );
    expectError(
      await api('POST', '/api/messages/conversations', { token: awa.token, body: { userId: 999999 } }),
      404,
      'err.userNotFound',
    );
    assert.equal(
      (await api('POST', '/api/messages/conversations', { token: awa.token, body: { userId: 'abc' } })).status,
      400,
    );
    assert.equal((await api('POST', '/api/messages/conversations', { token: awa.token, body: {} })).status, 400);
    assert.equal((await api('GET', '/api/messages/conversations/abc', { token: awa.token })).status, 400);
    expectError(
      await api('GET', '/api/messages/conversations/999999', { token: awa.token }),
      404,
      'err.conversationNotFound',
    );
  });

  it('keeps the newest 100 messages in a thread but counts every unread one', async () => {
    const created = await api('POST', '/api/messages/conversations', { token: moussa.token, body: { userId: aminata.id } });
    const longId = created.data.conversation.id;
    for (let index = 1; index <= 105; index += 1) await send(moussa, longId, `Message ${index}`);
    assert.equal(await unreadIn(aminata, longId), 105);

    const thread = await api('GET', `/api/messages/conversations/${longId}`, { token: aminata.token });
    assert.equal(thread.data.messages.length, 100);
    assert.equal(thread.data.messages[0].body, 'Message 6');
    assert.equal(thread.data.messages[99].body, 'Message 105');
    assert.equal(thread.data.conversation.unread, 0);
  });

  it('blocks messages to a suspended account and resumes once it is reactivated', async () => {
    const messagesRoute = `/api/messages/conversations/${conversationId}/messages`;
    const suspended = await api('PATCH', `/api/admin/users/${mamadou.id}`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.data));
    expectError(
      await api('POST', messagesRoute, { token: awa.token, body: { body: 'Vous êtes là ?' } }),
      403,
      'err.chatTargetInactive',
    );
    const thread = await api('GET', `/api/messages/conversations/${conversationId}`, { token: awa.token });
    assert.equal(thread.status, 200, 'the history stays readable');

    const restored = await api('PATCH', `/api/admin/users/${mamadou.id}`, { token: admin.token, body: { status: 'active' } });
    assert.equal(restored.status, 200);
    await send(awa, conversationId, 'Vous êtes là ?');
  });
});

describe('contacts', () => {
  let awa: Session;
  let admin: Session;
  let aminata: Session;

  before(async () => {
    awa = await login('buyer@market.local');
    admin = await login('admin@market.local', 'admin1234');
    aminata = await login('conductor2@market.local');
  });

  it('lists approved accounts except the caller, with no contact details', async () => {
    const res = await api('GET', '/api/messages/contacts', { token: awa.token });
    assert.equal(res.status, 200);
    const names = res.data.contacts.map((contact: any) => contact.name);
    assert.ok(names.includes('Marche Bou Makk Admin'), 'the admin is a normal contact');
    assert.ok(names.includes('Mamadou Ndiaye'));
    assert.equal(names.includes('Awa Diallo'), false, 'the caller is not listed');
    assert.equal(names.includes('Ibrahima Fall'), false, 'pending accounts are not listed');
    assert.equal(
      res.data.contacts.some((contact: any) => contact.storeName === 'Keur Yaye Cuisine'),
      false,
      'the pending store is not listed',
    );
    for (const contact of res.data.contacts) {
      assert.deepEqual(Object.keys(contact).sort(), ['id', 'name', 'phone', 'role', 'storeName']);
    }
    assert.equal(JSON.stringify(res.data).includes('@market.local'), false, 'emails stay private');
  });

  it('matches names and store names regardless of case', async () => {
    const names = async (query: string) => {
      const res = await api('GET', `/api/messages/contacts?q=${encodeURIComponent(query)}`, { token: awa.token });
      return res.data.contacts.map((contact: any) => contact.name);
    };
    assert.deepEqual(await names('TERANGA'), ['Mamadou Ndiaye']);
    assert.deepEqual(await names('MOUSSA'), ['Moussa Diop']);
    assert.deepEqual(await names('ÉPICERIE'), ['Fatou Sow']);
    assert.deepEqual(await names('zzz'), []);
  });

  it('hides suspended accounts until they are reactivated', async () => {
    const listed = async () => {
      const res = await api('GET', '/api/messages/contacts?q=aminata', { token: awa.token });
      return res.data.contacts.length > 0;
    };
    assert.equal(await listed(), true);
    await api('PATCH', `/api/admin/users/${aminata.id}`, { token: admin.token, body: { status: 'suspended' } });
    assert.equal(await listed(), false);
    await api('PATCH', `/api/admin/users/${aminata.id}`, { token: admin.token, body: { status: 'active' } });
    assert.equal(await listed(), true);
  });
});
