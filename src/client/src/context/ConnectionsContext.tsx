import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from './AuthContext';
import { useBots } from './BotContext';

/**
 * Chat connection row from `GET /api/bots/:id/connections`.
 * @interface ChatConnection
 * @property {number} id - Connection identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} chat_id - Numeric chat id (with `-100…`) or `@username`.
 * @property {string} title - Human-readable chat title.
 * @property {string} type - `channel`, `group`, or `supergroup`.
 * @property {string | null} username - Public username without the @.
 * @property {number} is_active - Active flag (1/0).
 * @property {string | null} created_at - Creation timestamp.
 */
export interface ChatConnection {
  id: number;
  bot_id: number;
  botId?: number;
  chat_id: string;
  chatId?: string;
  title: string;
  type: string;
  username: string | null;
  is_active: number;
  isActive?: number;
  created_at: string | null;
  createdAt?: string | null;
}

/**
 * Connections context value: the active bot's group/channel address book.
 * @interface ConnectionsContextValue
 * @property {ChatConnection[]} connections - Connection rows.
 * @property {boolean} loading - True until the first load settles.
 * @property {() => void} refresh - Reloads the list from the API.
 */
interface ConnectionsContextValue {
  connections: ChatConnection[];
  loading: boolean;
  refresh: () => void;
}

const ConnectionsContext = createContext<ConnectionsContextValue>({
  connections: [],
  loading: true,
  refresh: () => undefined,
});

/**
 * Provides the active bot's chat connections so every module page can power
 * its target-chat dropdowns from one shared list.
 * @param {object} props - Component props.
 * @param {React.ReactNode} props.children - Wrapped application tree.
 * @returns {React.ReactElement} The provider element.
 */
export function ConnectionsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { authenticated } = useAuth();
  const { activeBot } = useBots();
  const [connections, setConnections] = useState<ChatConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!activeBot) {
      setConnections([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<ChatConnection[]>(`/api/bots/${activeBot.id}/connections`)
      .then((rows) => {
        setConnections(rows);
        setLoading(false);
      })
      .catch(() => {
        setConnections([]);
        setLoading(false);
      });
  }, [activeBot]);

  useEffect(() => {
    if (!authenticated) return;
    refresh();
  }, [authenticated, refresh]);

  const value = useMemo(() => ({ connections, loading, refresh }), [connections, loading, refresh]);

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

/**
 * Accesses the shared chat connections of the active bot.
 * @returns {ConnectionsContextValue} Connection list and refresh handle.
 */
export function useConnections(): ConnectionsContextValue {
  return useContext(ConnectionsContext);
}

/**
 * Builds the dashboard route of the Connections module for a bot.
 * @param {number} botId - Active bot id.
 * @returns {string} Route path.
 */
export function connectionsRoute(botId: number): string {
  return `/bots/${botId}/m/connections`;
}
