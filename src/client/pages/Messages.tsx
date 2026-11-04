import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api, uploadImage } from '../api';
import { useAuth } from '../auth';
import { useApi, useAction, useDebounced } from '../hooks';
import { useI18n } from '../i18n';
import { useLive } from '../live';
import { useSettings } from '../settings';
import { Card, Empty, ErrorState, Loading, Notice, PageHeader } from '../ui';
import { formatDateTime, roleLabel, timeAgo } from '../format';
import type { ChatConversation, ChatMessage, ChatPerson } from '../../shared/types';
import '../chat.css';

interface ThreadData {
  conversation: ChatConversation;
  messages: ChatMessage[];
}

export function MessagesPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { chatTick, refreshChat } = useLive();
  const navigate = useNavigate();
  const params = useParams();
  const search = useSearchParams()[0];
  const conversationId = params.conversationId ? Number(params.conversationId) : null;
  const withUserId = search.get('with') ? Number(search.get('with')) : null;

  return (
    <div className="page chat-page">
      <PageHeader title={t('chat.title')} subtitle={t('chat.subtitle')} />
      <MessagesBody conversationId={conversationId} withUserId={withUserId} chatTick={chatTick} refreshChat={refreshChat} canSend={user?.status === 'active'} navigate={navigate} />
    </div>
  );
}

function MessagesBody({ conversationId, withUserId, chatTick, refreshChat, canSend, navigate }: { conversationId: number | null; withUserId: number | null; chatTick: number; refreshChat: () => void; canSend: boolean; navigate: (path: string, opts?: { replace?: boolean }) => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const conversations = useApi(() => api<{ conversations: ChatConversation[]; unreadTotal: number }>('/messages/conversations').then((d) => d), []);
  const [creating, setCreating] = useState(false);

  // create conversation from ?with=
  useEffect(() => {
    if (!withUserId || !canSend || creating) return;
    setCreating(true);
    api<{ conversation: ChatConversation }>('/messages/conversations', { method: 'POST', body: { userId: withUserId } })
      .then((data) => {
        navigate(`/messages/${data.conversation.id}`, { replace: true });
      })
      .catch(() => undefined)
      .finally(() => setCreating(false));
  }, [withUserId, canSend, creating]);

  useEffect(() => {
    conversations.reload();
  }, [chatTick]);

  const selectedId = conversationId;

  return (
    <div className={`chat-layout ${selectedId ? 'has-thread' : ''}`}>
      <ConversationList conversations={conversations.data?.conversations ?? []} loading={conversations.loading} selectedId={selectedId} canSend={canSend} navigate={navigate} />
      {selectedId ? (
        <Thread conversationId={selectedId} canSend={canSend} onLoaded={refreshChat} navigate={navigate} />
      ) : (
        <div className="chat-empty">{t('chat.pickConversation')}</div>
      )}
    </div>
  );
}

function ConversationList({ conversations, loading, selectedId, canSend, navigate }: { conversations: ChatConversation[]; loading: boolean; selectedId: number | null; canSend: boolean; navigate: (path: string, opts?: { replace?: boolean }) => void }) {
  const { t } = useI18n();
  const [showPeople, setShowPeople] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const contacts = useApi(() => (showPeople ? api<{ contacts: ChatPerson[] }>(`/messages/contacts?q=${encodeURIComponent(debounced)}`).then((d) => d.contacts) : Promise.resolve([] as ChatPerson[])), [showPeople, debounced]);

  async function startChat(userId: number) {
    const result = await api<{ conversation: ChatConversation }>('/messages/conversations', { method: 'POST', body: { userId } });
    setShowPeople(false);
    navigate(`/messages/${result.conversation.id}`);
  }

  return (
    <div className="chat-list">
      <div className="chat-list-head">
        <h3>{t('chat.people')}</h3>
        <button className="btn small primary" disabled={!canSend} onClick={() => setShowPeople((v) => !v)}>
          {t('chat.newMessage')}
        </button>
      </div>
      {showPeople && (
        <div className="chat-people">
          <input placeholder={t('chat.searchPeople')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {contacts.loading && <Loading />}
          {!contacts.loading && (contacts.data ?? []).length === 0 && <p className="muted small">{t('chat.noPeople')}</p>}
          {(contacts.data ?? []).map((person) => (
            <button key={person.id} className="chat-person" onClick={() => startChat(person.id)}>
              <strong>{person.name}</strong>
              <span className="muted small">{roleLabel(person.role)}{person.storeName ? ` · ${person.storeName}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {!showPeople && conversations.length === 0 && (
        <div className="chat-empty">
          <p>{t('chat.noConversations')}</p>
          <p className="muted small">{t('chat.noConversationsHint')}</p>
        </div>
      )}
      {conversations.map((conv) => (
        <button key={conv.id} type="button" onClick={() => navigate(`/messages/${conv.id}`)} className={`chat-item ${selectedId === conv.id ? 'active' : ''}`}>
          <div className="chat-item-name">{conv.other.name}</div>
          <div className="muted small">{roleLabel(conv.other.role)}{conv.other.storeName ? ` · ${conv.other.storeName}` : ''}</div>
          {conv.lastMessage && (
            <>
              <div className="chat-item-preview">{conv.lastMessage.body.slice(0, 60) || (conv.lastMessage.imageUrl ? t('chat.photoPreview') : '')}</div>
              <div className="muted small">{timeAgo(conv.lastMessage.createdAt)}</div>
            </>
          )}
          {conv.unread > 0 && <span className="chat-badge">{t('chat.unread', { count: conv.unread })}</span>}
        </button>
      ))}
    </div>
  );
}

function Thread({ conversationId, canSend, onLoaded, navigate }: { conversationId: number; canSend: boolean; onLoaded: () => void; navigate: (path: string, opts?: { replace?: boolean }) => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { chatTick } = useLive();
  const action = useAction();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastId = thread?.messages.at(-1)?.id;

  useEffect(() => {
    let active = true;
    api<ThreadData>(`/messages/conversations/${conversationId}`)
      .then((data) => {
        if (!active) return;
        setThread(data);
        setError(null);
        onLoaded();
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [conversationId, chatTick]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lastId]);

  // listen for incoming calls
  useEffect(() => {
    const handler = (e: any) => {
      const detail = e.detail;
      if (detail?.conversationId !== conversationId) return;
      if (detail.type === 'ring' || detail.type === 'offer') setIncomingCall(detail);
      if (detail.type === 'hangup') setIncomingCall(null);
    };
    window.addEventListener('mbm:call', handler);
    return () => window.removeEventListener('mbm:call', handler);
  }, [conversationId]);

  async function send() {
    if ((!text.trim() && !image) || !canSend || action.busy) return;
    const result = await action.run(() =>
      api<{ message: ChatMessage }>(`/messages/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { body: text.trim(), imageUrl: image },
      }),
    );
    if (!result) return;
    const sent = result.message;
    setThread((current) => {
      if (!current || current.messages.some((item) => item.id === sent.id)) return current;
      return { ...current, messages: [...current.messages, sent] };
    });
    setText('');
    setImage(null);
  }

  async function onAttach(file: File) {
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setImage(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function startCall(video: boolean) {
    setCalling(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      // send ring
      await api(`/messages/conversations/${conversationId}/call`, { method: 'POST', body: { type: 'ring', payload: { video } } });
      // basic: show local preview; full WebRTC signaling omitted for brevity
      const videoEl = document.getElementById('local-video') as HTMLVideoElement | null;
      if (videoEl) { videoEl.srcObject = stream; videoEl.play(); }
    } catch (e: any) {
      setError(e.message || t('chat.cameraDenied'));
      setCalling(false);
    }
  }

  if (error && !thread) return <ErrorState message={error} />;

  const conv = thread?.conversation;
  const otherPhone = conv?.other?.phone;

  return (
    <div className="chat-thread">
      <div className="chat-thread-head">
        <button className="chat-back btn small" onClick={() => navigate('/messages')}>
          {t('chat.back')}
        </button>
        {conv && (
          <>
            <div>
              <strong>{conv.other.name}</strong>
              <div className="muted small">{roleLabel(conv.other.role)}{conv.other.storeName ? ` · ${conv.other.storeName}` : ''}</div>
            </div>
            <div className="row-gap">
              {otherPhone && (
                <a className="btn small" href={`tel:${otherPhone}`}>📞 {t('chat.call')}</a>
              )}
              <button className="btn small" disabled={!canSend} onClick={() => startCall(true)}>📹 {t('chat.video')}</button>
            </div>
          </>
        )}
      </div>

      {incomingCall && (
        <Notice tone="info">
          {t(incomingCall.payload?.video ? 'chat.incomingVideo' : 'chat.incomingVoice', { name: incomingCall.fromName })}
          <div className="row-gap" style={{ marginTop: 8 }}>
            <button className="btn small primary" onClick={() => { setIncomingCall(null); startCall(incomingCall.payload?.video); }}>{t('chat.accept')}</button>
            <button className="btn small" onClick={() => { setIncomingCall(null); api(`/messages/conversations/${conversationId}/call`, { method: 'POST', body: { type: 'hangup' } }).catch(() => undefined); }}>{t('chat.decline')}</button>
          </div>
        </Notice>
      )}

      {calling && (
        <div className="card">
          <video id="local-video" autoPlay muted playsInline style={{ width: '100%', maxHeight: 240, borderRadius: 8 }} />
          <div className="row-gap" style={{ marginTop: 8 }}>
            <button className="btn small danger" onClick={() => { setCalling(false); const v = document.getElementById('local-video') as HTMLVideoElement; if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach((tr) => tr.stop()); }}>{t('chat.hangUp')}</button>
          </div>
        </div>
      )}

      <div className="chat-messages" ref={logRef}>
        {!thread && !error && <Loading />}
        {thread && thread.messages.length === 0 && <div className="chat-empty">{t('chat.noMessages')}</div>}
        {thread?.messages.map((msg) => {
          const mine = msg.senderId === user?.id;
          return (
            <div key={msg.id} className={`chat-bubble ${mine ? 'mine' : ''}`}>
              {msg.imageUrl && (/\.(mp4|webm|mov)$/i.test(msg.imageUrl) ? (
                <video src={msg.imageUrl} controls style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 4 }} />
              ) : (
                <img src={msg.imageUrl} alt={t('chat.attachment')} style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 4 }} />
              ))}
              {msg.body && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{msg.body}</div>}
              <div className="chat-bubble-meta">{formatDateTime(msg.createdAt)}</div>
            </div>
          );
        })}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {canSend ? (
        <div className="chat-composer">
          {image && (
            <div style={{ marginBottom: 8 }}>
              {/\.(mp4|webm|mov)$/i.test(image) ? (
                <video src={image} style={{ maxHeight: 80, borderRadius: 6 }} />
              ) : (
                <img src={image} alt={t('chat.attachment')} style={{ maxHeight: 80, borderRadius: 6 }} />
              )}
              <button type="button" className="btn small" onClick={() => setImage(null)}>✕</button>
            </div>
          )}
          <div className="row-gap">
            <label className="btn small" style={{ cursor: 'pointer' }}>
              📷
              <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ''; }} />
            </label>
            <textarea
              placeholder={t('chat.typeMessage')}
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="btn primary" disabled={action.busy || uploading || (!text.trim() && !image)} onClick={send}>
              {action.busy ? t('chat.sending') : t('chat.send')}
            </button>
          </div>
        </div>
      ) : (
        <Notice tone="warn">{t('chat.pending')}</Notice>
      )}
    </div>
  );
}
