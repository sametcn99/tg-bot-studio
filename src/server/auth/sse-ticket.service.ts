import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 200;

interface TicketEntry {
  token: string;
  expiresAt: number;
}

/**
 * Issues short-lived, single-use tickets that let `EventSource` (which cannot
 * set headers) authenticate SSE streams without putting the long-lived JWT
 * into the URL, where it would leak into access logs, history, and Referers.
 */
@Injectable()
export class SseTicketService {
  private readonly tickets = new Map<string, TicketEntry>();

  /**
   * Exchanges a valid JWT for a one-time ticket.
   * @param {string} token - Raw JWT of the authenticated session.
   * @returns {string} Opaque ticket usable once within 30 seconds.
   */
  issue(token: string): string {
    this.evictExpired();
    if (this.tickets.size >= MAX_TICKETS) {
      const oldest = this.tickets.keys().next().value;
      if (oldest !== undefined) this.tickets.delete(oldest);
    }
    const ticket = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    this.tickets.set(ticket, { token, expiresAt: Date.now() + TICKET_TTL_MS });
    return ticket;
  }

  /**
   * Consumes a ticket: returns the bound JWT exactly once.
   * @param {string} ticket - Ticket presented at stream open.
   * @returns {string | null} The bound JWT, or null when unknown/expired/used.
   */
  consume(ticket: string): string | null {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.token;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}
