import React, { useEffect, useState } from 'react';
import { tmaFetch } from '../api';
import { haptic, isInsideTelegram, webApp } from '../sdk/telegram';
import { createT } from '../i18n';
import type { TmaAppConfig } from '../App';

/**
 * Loyalty profile payload from `/api/tma/:slug/me`.
 * @interface LoyaltyState
 * @property {number} points - Current point balance.
 * @property {boolean} checkedInToday - Daily check-in status.
 */
interface LoyaltyState {
  points: number;
  checkedInToday: boolean;
}

/**
 * Loyalty, Points & Referral Hub template: balance card, rank tiers, daily
 * check-in, and a deep-linked referral share button.
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The loyalty hub view.
 */
export default function Loyalty({ config }: { config: TmaAppConfig }): React.ReactElement {
  const t = createT(config.config);
  const [state, setState] = useState<LoyaltyState | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const tiers = (config.config.tiers as Array<{ name: string; minPoints: number }>) ?? [];
  const referralUrl = String(
    config.config.referralUrl ??
      `https://t.me/${config.config.botUsername ?? ''}?startapp=${config.slug}`,
  );

  useEffect(() => {
    if (!isInsideTelegram()) return;
    tmaFetch<LoyaltyState>(`/api/tma/${config.slug}/me`)
      .then(setState)
      .catch((error: Error) => setStatus(error.message));
  }, [config.slug]);

  /**
   * Performs the daily check-in.
   * @returns {Promise<void>} Resolves after the server responded.
   */
  async function checkin(): Promise<void> {
    try {
      const result = await tmaFetch<LoyaltyState & { awarded: number }>(
        `/api/tma/${config.slug}/checkin`,
        { method: 'POST' },
      );
      haptic('medium');
      setState({ points: result.points, checkedInToday: true });
      setStatus(
        t('loyalty.checkInComplete', 'Check-in complete. +{points} points.', {
          points: result.awarded,
        }),
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : t('loyalty.checkInFailed', 'Check-in failed'),
      );
    }
  }

  return (
    <>
      <div className="card">
        <div className="muted">{t('loyalty.pointsBalance', 'Points balance')}</div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {state?.points ?? 0}
        </div>
        <button
          className="primary"
          style={{ marginTop: 12 }}
          onClick={() => void checkin()}
          disabled={state?.checkedInToday || !isInsideTelegram()}
        >
          {state?.checkedInToday
            ? t('loyalty.checkedInToday', 'Checked in today')
            : t('loyalty.dailyCheckIn', 'Daily check-in')}
        </button>
      </div>

      {tiers.length > 0 && (
        <div className="tiers">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`tier${state && state.points >= tier.minPoints ? ' active' : ''}`}
            >
              <span>{tier.name}</span>
              <span className="muted">
                {t('loyalty.tierPoints', '{points}+ pts', { points: tier.minPoints })}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {t('loyalty.inviteFriends', 'Invite friends')}
        </div>
        <div className="muted" style={{ marginBottom: 10 }}>
          {t(
            'loyalty.inviteHint',
            'Share your referral link and earn bonus points for every friend who joins.',
          )}
        </div>
        <button
          className="secondary"
          onClick={() => {
            if (webApp && referralUrl.includes('t.me')) {
              webApp.openTelegramLink(referralUrl);
            }
          }}
        >
          {t('loyalty.share', 'Share referral link')}
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
