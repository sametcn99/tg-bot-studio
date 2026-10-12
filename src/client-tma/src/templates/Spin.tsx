import React, { useState } from 'react';
import { tmaFetch } from '../api';
import { haptic, isInsideTelegram } from '../sdk/telegram';
import type { TmaAppConfig } from '../App';

/**
 * Prize definition from the Spin template config.
 * @interface Prize
 * @property {string} label - Prize display label.
 * @property {number} points - Points awarded when drawn.
 */
interface Prize {
  label: string;
  points: number;
}

/**
 * Gamification & Daily Spin template: a rotating reward wheel with a daily
 * draw limit, prize inventory list, and the resulting point award.
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The spin wheel view.
 */
export default function Spin({ config }: { config: TmaAppConfig }): React.ReactElement {
  const prizes = (config.config.prizes as Prize[]) ?? [];
  const colors = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#ca8a04', '#dc2626'];
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);

  const gradient = prizes.length
    ? `conic-gradient(${prizes
        .map((_, index) => {
          const start = (index / prizes.length) * 100;
          const end = ((index + 1) / prizes.length) * 100;
          return `${colors[index % colors.length]} ${start}% ${end}%`;
        })
        .join(', ')})`
    : 'conic-gradient(#2563eb 0% 100%)';

  /**
   * Runs the daily spin: requests a server-drawn prize and animates the
   * wheel to the winning segment.
   * @returns {Promise<void>} Resolves after the animation completes.
   */
  async function spin(): Promise<void> {
    if (spinning || prizes.length === 0) return;
    setSpinning(true);
    setResult(null);
    try {
      const response = await tmaFetch<{ prize: Prize; points: number }>(
        `/api/tma/${config.slug}/spin`,
        { method: 'POST', body: JSON.stringify({ prizes }) },
      );
      const index = prizes.findIndex((prize) => prize.label === response.prize.label);
      const segment = 360 / prizes.length;
      const target = 360 * 5 + (360 - index * segment - segment / 2);
      setRotation((current) => current + target);
      haptic('heavy');
      window.setTimeout(() => {
        setResult(response.prize.label);
        setPoints(response.points);
        setSpinning(false);
      }, 4200);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Spin failed');
      setSpinning(false);
    }
  }

  return (
    <>
      <div className="wheel-stage">
        <div className="wheel-pointer" />
        <div className="wheel" style={{ background: gradient, transform: `rotate(${rotation}deg)` }} />
        <button
          className="primary"
          onClick={() => void spin()}
          disabled={spinning || prizes.length === 0 || !isInsideTelegram()}
        >
          {spinning ? 'Spinning...' : 'Spin the wheel'}
        </button>
        {result && (
          <div className="card" style={{ textAlign: 'center' }} role="status" aria-live="polite">
            <div style={{ fontWeight: 700 }}>{result}</div>
            {points !== null && <div className="muted">Current balance: {points} pts</div>}
          </div>
        )}
      </div>

      <div className="prize-list">
        <div className="muted" style={{ marginBottom: 4 }}>
          Prize inventory
        </div>
        {prizes.map((prize) => (
          <div key={prize.label} className="row">
            <span>{prize.label}</span>
            <span className="muted">{prize.points} pts</span>
          </div>
        ))}
        {prizes.length === 0 && <div className="muted">No prizes configured yet.</div>}
      </div>
    </>
  );
}
