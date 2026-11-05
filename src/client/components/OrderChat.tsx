import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatDateTime } from '../format';
import { useAction } from '../hooks';
import { useI18n } from '../i18n';
import { useLive } from '../live';
import { Loading, Notice } from '../ui';
import type { ChatConversation, ChatMessage } from '../../shared/types';
import '../chat.css';

// A short chat with the other person on this order, shown on the order page.
// Photos, calls and older history stay in Messages.
export function OrderChat({ withUserId }: { withUserId: number }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { chatTick, refreshChat } = useLive();
  const action = useAction();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const lastId = messages?.at(-1)?.id;
  const canSend = user?.status === 'active';

  useEffect(() => {
    let active = true;
    setConversationId(null);
    setMessages(null);
    api<{ conversation: ChatConversation }>('/messages/conversations', { method: 'POST', body: { userId: withUserId } })
      .then((data) => {
        if (active) setConversationId(data.conversation.id);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [withUserId]);

  useEffect(() => {
    if (conversationId === null) return;
    let active = true;
    api<{ messages: ChatMessage[] }>(`/messages/conversations/${conversationId}`)
      .then((data) => {
        if (!active) return;
        setMessages(data.messages);
        setError(null);
        refreshChat();
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, chatTick]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lastId]);

  async function send() {
    const body = text.trim();
    if (!body || conversationId === null || !canSend || action.busy) return;
    const result = await action.run(() =>
      api<{ message: ChatMessage }>(`/messages/conversations/${conversationId}/messages`, { method: 'POST', body: { body, imageUrl: null } }),
    );
    if (!result) return;
    const sent = result.message;
    setMessages((current) => (current?.some((item) => item.id === sent.id) ? current : [...(current ?? []), sent]));
    setText('');
  }

  return (
    <div className="order-chat">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="chat-messages" ref={logRef}>
        {messages === null && !error && <Loading />}
        {messages?.length === 0 && <div className="chat-empty">{t('chat.noMessages')}</div>}
        {messages?.map((message) => (
          <div key={message.id} className={`chat-bubble ${message.senderId === user?.id ? 'mine' : ''}`}>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.body}</div>
            <div className="chat-bubble-meta">{formatDateTime(message.createdAt)}</div>
          </div>
        ))}
      </div>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {canSend ? (
        <div className="chat-composer">
          <div className="chat-compose-row">
            <textarea
              placeholder={t('chat.typeMessage')}
              maxLength={1000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn primary" disabled={action.busy || conversationId === null || !text.trim()} onClick={send}>
              {action.busy ? t('chat.sending') : t('chat.send')}
            </button>
          </div>
        </div>
      ) : (
        <Notice tone="warn">{t('chat.pending')}</Notice>
      )}
      <Link to={`/messages?with=${withUserId}`} className="link small">
        {t('order.openFullChat')} →
      </Link>
    </div>
  );
}
