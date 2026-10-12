import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from './AuthContext';

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
  id: number;
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
 * @property {BotSummary[]} bots - All registered bots.
 * @property {BotSummary | null} activeBot - Currently selected bot.
 * @property {(botId: number) => void} setActiveBotId - Switches the active zone.
 * @property {() => void} refresh - Reloads the bot list from the API.
 */
interface BotContextValue {
  bots: BotSummary[];
  activeBot: BotSummary | null;
  setActiveBotId: (botId: number) => void;
  refresh: () => void;
}

const BotContext = createContext<BotContextValue>({
  bots: [],
  activeBot: null,
  setActiveBotId: () => undefined,
  refresh: () => undefined,
});

/**
 * Provides the bot list and the active bot selection. The active bot id is
 * persisted to localStorage so the zone survives reloads.
 * @param {object} props - Component props.
 * @param {React.ReactNode} props.children - Wrapped application tree.
 * @returns {React.ReactElement} The provider element.
 */
export function BotProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { authenticated } = useAuth();
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [activeBotId, setActiveBotIdState] = useState<number | null>(() => {
    const stored = window.localStorage.getItem('studio-active-bot');
    return stored ? Number(stored) : null;
  });

  const refresh = useCallback(() => {
    apiFetch<BotSummary[]>('/api/bots')
      .then((list) => {
        setBots(list);
        setActiveBotIdState((current) =>
          current && list.some((bot) => bot.id === current)
            ? current
            : (list[0]?.id ?? null),
        );
      })
      .catch(() => undefined);
  }, []);

  // The bot list loads only while authenticated; without this guard the
  // mount-time call on the login page would 401 and reload-loop the app.
  useEffect(() => {
    if (!authenticated) return;
    refresh();
  }, [authenticated, refresh]);

  const setActiveBotId = useCallback((botId: number) => {
    setActiveBotIdState(botId);
    window.localStorage.setItem('studio-active-bot', String(botId));
  }, []);

  const activeBot = useMemo(
    () => bots.find((bot) => bot.id === activeBotId) ?? null,
    [bots, activeBotId],
  );

  const value = useMemo(
    () => ({ bots, activeBot, setActiveBotId, refresh }),
    [bots, activeBot, setActiveBotId, refresh],
  );

  return <BotContext.Provider value={value}>{children}</BotContext.Provider>;
}

/**
 * Accesses the bot context.
 * @returns {BotContextValue} Bot list and active selection.
 */
export function useBots(): BotContextValue {
  return useContext(BotContext);
}
