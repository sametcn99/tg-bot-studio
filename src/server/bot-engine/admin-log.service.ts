import { Injectable, Logger } from '@nestjs/common';

/** reference-aligned admin-log categories. */
export type AdminLogCategory = 'settings' | 'admin' | 'user' | 'automated' | 'reports' | 'other';

/** A single admin-log event emitted by a module runtime. */
export interface AdminLogEvent {
  botId: string;
  chatId: number;
  category: AdminLogCategory;
  /** Human-readable description, already localized when applicable. */
  text: string;
}

/** Listener registered by the admin-log module runtime (per bot). */
export type AdminLogListener = (event: AdminLogEvent) => void;

/**
 * In-process bus carrying moderation/automation events from every runtime to
 * the admin-log module, which forwards them to Telegram log channels with
 * per-category filters. Dashboard audit trails remain a separate concern
 * (AuditService / SecurityLog).
 */
@Injectable()
export class AdminLogService {
  private readonly logger = new Logger(AdminLogService.name);
  private readonly listeners = new Map<string, AdminLogListener>();

  /**
   * Registers (replacing any previous) the log listener for a bot. Called on
   * every module attach; passing null detaches.
   *
   * @param {string} botId - Studio bot id.
   * @param {AdminLogListener | null} listener - Event sink or null to detach.
   * @returns {void}
   */
  subscribe(botId: string, listener: AdminLogListener | null): void {
    if (listener === null) {
      this.listeners.delete(botId);
    } else {
      this.listeners.set(botId, listener);
    }
  }

  /**
   * Emits an event to the owning bot's listener, tolerating handler errors.
   *
   * @param {AdminLogEvent} event - Fully populated log event.
   * @returns {void}
   */
  emit(event: AdminLogEvent): void {
    const listener = this.listeners.get(event.botId);
    if (!listener) return;
    try {
      listener(event);
    } catch (error) {
      this.logger.warn(
        `Admin log listener failed for bot ${event.botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
