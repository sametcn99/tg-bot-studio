import type { SecurityLog, Session } from '@prisma/client';

/**
 * Domain shape for session row.
 */
export interface SessionEntity {
  id: string;
  ip: string;
  user_agent: string | null;
  browser: string;
  os: string;
  device_type: string;
  created_at: string;
  last_active_at: string;
  is_revoked: number;
}

/**
 * Domain shape for security log row.
 */
export interface SecurityLogEntity {
  id: number;
  event: string;
  ip: string | null;
  user_agent: string | null;
  details: string | null;
  created_at: string;
}
