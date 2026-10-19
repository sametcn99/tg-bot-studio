import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from './AuthContext';
import { localizedErrorMessage } from '../utils/errors';

/**
 * Enriched bot record returned by `GET /api/bots`.
 * @interface BotSummary
 * @property {number} id - Studio bot identifier.
 * @property {string} name - Display name.
 * @property {string} username - Bot @username.
 * @property {number} is_active - Enabled flag (1/0).
 * @property {string} status - Runtime health state.
 * @property {number} activeModules - Enabled module count.
 * @property {number} miniApps - Hosted Mini App count.
 * @property {number} subscribers - Audience size.
 * @property {number} dailyVolume - Messages in the current UTC day.
 */
export interface BotSummary {
  id: string;
  name: string;
  username: string | null;
  is_active: number;
  status: string;
  activeModules: number;
  miniApps: number;
  subscribers: number;
  dailyVolume: number;
}

/**
 * Bot context value (Cloudflare-style zone switcher state).
 * @interface BotContextValue
 * @property {BotSummary[]} bots - All registered bots (empty until loaded).
 * @property {boolean} loading - True while the initial bot list loads.
 * @property {string | null} error - Localized load error, or null.
 * @property {BotSummary | null} activeBot - Currently selected bot.
 * @property {(botId: string) => void} setActiveBotId - Switches the active zone.
 * @property {() => void} refresh - Reloads the bot list from the API.
 */
interface BotContextValue {
  bots: BotSummary[];
  loading: boolean;
  error: string | null;
  activeBot: BotSummary | null;
  setActiveBotId: (botId: string) => void;
  refresh: () => void;
}

const BotContext = createContext<BotContextValue>({
  bots: [],
  loading: false,
  error: null,
  activeBot: null,
  setActiveBotId: () => undefined,
  refresh: () => undefined,
});

/**
 * Provides the bot list and the active bot selection. The active bot id is
 * persisted to localStorage so the zone survives reloads. Load failures are
 * surfaced through `error` instead of masquerading as an empty account.
 * @param {object} props - Component props.
 * @param {React.ReactNode} props.children - Wrapped application tree.
 * @returns {React.ReactElement} The provider element.
 */
export function BotProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { authenticated } = useAuth();
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBotId, setActiveBotIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const match = window.location.pathname.match(/^\/bots\/([^/]+)/);
      if (match && match[1]) return match[1];
      const stored = window.localStorage.getItem('studio-active-bot');
      if (stored) return stored;
    }
    return null;
  });

  const refresh = useCallback(() => {
    setLoading(true);
    apiFetch<BotSummary[]>('/api/bots')
      .then((list) => {
        setBots(list);
        setError(null);
        setActiveBotIdState((current) => {
          if (current && list.some((bot) => bot.id === current)) return current;
          if (typeof window !== 'undefined') {
            const match = window.location.pathname.match(/^\/bots\/([^/]+)/);
            if (match && match[1] && list.some((bot) => bot.id === match[1])) {
              return match[1];
            }
          }
          return list[0]?.id ?? null;
        });
      })
      .catch((err: unknown) => {
        setError(localizedErrorMessage(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // The bot list loads only while authenticated; without this guard the
  // mount-time call on the login page would 401 and reload-loop the app.
  useEffect(() => {
    if (!authenticated) return;
    refresh();
  }, [authenticated, refresh]);

  const setActiveBotId = useCallback((botId: string) => {
    setActiveBotIdState(botId);
    window.localStorage.setItem('studio-active-bot', String(botId));
  }, []);

  const activeBot = useMemo(
    () => bots.find((bot) => bot.id === activeBotId) ?? null,
    [bots, activeBotId],
  );

  const value = useMemo(
    () => ({ bots, loading, error, activeBot, setActiveBotId, refresh }),
    [bots, loading, error, activeBot, setActiveBotId, refresh],
  );

  return <BotContext.Provider value={value}>{children}</BotContext.Provider>;
}

/**
 * Accesses the bot context.
 * @returns {BotContextValue} Bot list, load state, and active selection.
 */
export function useBots(): BotContextValue {
  return useContext(BotContext);
}
