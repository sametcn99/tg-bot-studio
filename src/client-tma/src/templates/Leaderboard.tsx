import React, { useEffect, useState } from 'react';
import { tmaFetch } from '../api';
import { isInsideTelegram } from '../sdk/telegram';
import type { TmaAppConfig } from '../App';

/**
 * Leaderboard entry from `/api/tma/:slug/leaderboard`.
 * @interface LeaderboardEntry
 * @property {number} rank - 1-based position.
 * @property {string} name - Display name.
 * @property {string | null} username - Telegram username without @.
 * @property {number} points - Points balance.
 * @property {boolean} isMe - True for the requesting user.
 */
interface LeaderboardEntry {
  rank: number;
  name: string;
  username: string | null;
  points: number;
  isMe: boolean;
}

/**
 * Leaderboard payload.
 * @interface LeaderboardState
 * @property {LeaderboardEntry[]} entries - Top entries.
 * @property {number | null} myRank - Requesting user's rank when outside the list.
 * @property {number} total - Ranked member count.
 * @property {number} myPoints - Requesting user's points.
 */
interface LeaderboardState {
  entries: LeaderboardEntry[];
  myRank: number | null;
  total: number;
  myPoints: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Points leaderboard template: ranks members by their engagement points and
 * highlights the requesting user (also when they are outside the top list).
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The leaderboard view.
 */
export default function Leaderboard({ config }: { config: TmaAppConfig }): React.ReactElement {
  const [state, setState] = useState<LeaderboardState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInsideTelegram()) return;
    tmaFetch<LeaderboardState>(`/api/tma/${config.slug}/leaderboard`)
      .then(setState)
      .catch((err: Error) => setError(err.message));
  }, [config.slug]);

  if (error) return <div className="state-message">{error}</div>;
  if (!state) {
    return (
      <div className="card">
        <div className="muted">
          Earn points in chats and check-ins to appear on the leaderboard.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Top members</div>
        <div className="muted">
          {state.total} ranked member{state.total === 1 ? '' : 's'}
          {state.myPoints > 0 ? ` · you have ${state.myPoints} pts` : ''}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {state.entries.map((entry) => (
          <div
            key={entry.rank}
            className="tier"
            style={{
              borderRadius: 0,
              background: entry.isMe ? 'var(--tg-button-color)' : undefined,
              color: entry.isMe ? '#fff' : undefined,
            }}
          >
            <span>
              {MEDALS[entry.rank - 1] ?? `${entry.rank}.`} {entry.name}
            </span>
            <span className="muted" style={entry.isMe ? { color: '#fff' } : undefined}>
              {entry.points} pts
            </span>
          </div>
        ))}
        {state.entries.length === 0 && (
          <div className="muted" style={{ padding: 14 }}>
            No ranked members yet — be the first!
          </div>
        )}
      </div>

      {state.myRank !== null && (
        <div className="card">
          <div className="muted">Your position</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>#{state.myRank}</div>
        </div>
      )}
    </>
  );
}
