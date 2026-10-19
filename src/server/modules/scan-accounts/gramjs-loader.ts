/**
 * Lazy GramJS loader. Importing `telegram` eagerly pulls the `websocket`
 * package, whose top-level `require('bufferutil')` is unguarded — on a
 * platform where those native modules are missing or unloadable (seen on
 * Alpine/musl with Bun 1.4), that require crashed the whole server at boot.
 * Loading the kit lazily keeps boot GramJS-free: only scan-account login and
 * backfill touches it, and any platform failure surfaces as a per-feature
 * error instead of a crash loop.
 * @module modules/scan-accounts/gramjs-loader
 */
import type { Api, TelegramClient } from 'telegram';
import type { StringSession } from 'telegram/sessions';
import type { computeCheck } from 'telegram/Password';
import type { Logger as GramjsLogger, LogLevel } from 'telegram/extensions/Logger';

/** Runtime pieces of GramJS the scan-account services need. */
export interface GramjsKit {
  Api: typeof Api;
  TelegramClient: typeof TelegramClient;
  StringSession: typeof StringSession;
  computeCheck: typeof computeCheck;
  GramjsLogger: typeof GramjsLogger;
  LogLevel: typeof LogLevel;
}

/** Cached dynamic-import result (one GramJS load per process). */
let kitPromise: Promise<GramjsKit> | null = null;

/**
 * Loads (once) the GramJS runtime pieces used by the scan-account features.
 * @returns {Promise<GramjsKit>} GramJS kit.
 */
export function loadGramjs(): Promise<GramjsKit> {
  kitPromise ??= (async () => {
    const [core, sessions, password, logger] = await Promise.all([
      import('telegram'),
      import('telegram/sessions'),
      import('telegram/Password'),
      import('telegram/extensions/Logger'),
    ]);
    return {
      Api: core.Api,
      TelegramClient: core.TelegramClient,
      StringSession: sessions.StringSession,
      computeCheck: password.computeCheck,
      GramjsLogger: logger.Logger,
      LogLevel: logger.LogLevel,
    };
  })();
  return kitPromise;
}

/** Client type re-export so consumers avoid importing `telegram` at all. */
export type GramjsClient = TelegramClient;
