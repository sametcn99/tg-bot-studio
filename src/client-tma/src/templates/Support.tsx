import React, { useState } from 'react';
import { tmaFetch } from '../api';
import { haptic, isInsideTelegram, webApp } from '../sdk/telegram';
import type { TmaAppConfig } from '../App';

/**
 * Support desk template: collects a request inside Telegram, stores it in
 * the studio support inbox, and relays it to the configured admin chat.
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The support desk view.
 */
export default function Support({ config }: { config: TmaAppConfig }): React.ReactElement {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const greeting = String(
    config.config.greeting ??
      'Describe your issue and our team will reply here or in the bot chat.',
  );

  /**
   * Submits the support request.
   * @returns {Promise<void>} Resolves after the server responded.
   */
  async function submit(): Promise<void> {
    if (!message.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const user = webApp?.initDataUnsafe?.user;
      const senderName = [user?.first_name, user?.username ? `@${user.username}` : '']
        .filter(Boolean)
        .join(' ');
      await tmaFetch(`/api/tma/${config.slug}/support`, {
        method: 'POST',
        body: JSON.stringify({ message, senderName: senderName || undefined }),
      });
      haptic('medium');
      setStatus('Your request has been sent. We will get back to you soon.');
      setMessage('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Submission failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="muted">{greeting}</div>
        <div className="field" style={{ marginTop: 10 }}>
          <textarea
            style={{ minHeight: 120, resize: 'vertical' }}
            placeholder="How can we help?"
            value={message}
            maxLength={3500}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
        <button
          className="primary"
          style={{ marginTop: 10 }}
          onClick={() => void submit()}
          disabled={sending || !message.trim() || !isInsideTelegram()}
        >
          {sending ? 'Sending…' : 'Send request'}
        </button>
      </div>
      {status && (
        <div className="success-text" role="status" aria-live="polite">
          {status}
        </div>
      )}
    </>
  );
}
