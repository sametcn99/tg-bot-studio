import type { ScanAccount } from '@prisma/client';

/**
 * API-safe scan account row: the encrypted session is deliberately absent —
 * it never leaves the server.
 * @interface ScanAccountRow
 */
export interface ScanAccountRow {
  id: string;
  phone: string;
  label: string | null;
  username: string | null;
  firstName: string | null;
  status: string;
  lastUsedAt: string | null;
  createdAt: string | null;
}

/**
 * Maps a persisted scan account onto its API-safe row.
 * @param {ScanAccount} account - Prisma row.
 * @returns {ScanAccountRow} API-safe row.
 */
export function toScanAccountRow(account: ScanAccount): ScanAccountRow {
  return {
    id: account.id,
    phone: account.phone,
    label: account.label,
    username: account.username,
    firstName: account.firstName,
    status: account.status,
    lastUsedAt: account.lastUsedAt,
    createdAt: account.createdAt,
  };
}
