import { Injectable } from '@nestjs/common';
import enMessages from '../i18n/locales/bot-messages.en.json';
import trMessages from '../i18n/locales/bot-messages.tr.json';
import deMessages from '../i18n/locales/bot-messages.de.json';
import ruMessages from '../i18n/locales/bot-messages.ru.json';
import esMessages from '../i18n/locales/bot-messages.es.json';
import azMessages from '../i18n/locales/bot-messages.az.json';
import arMessages from '../i18n/locales/bot-messages.ar.json';
import frMessages from '../i18n/locales/bot-messages.fr.json';
import itMessages from '../i18n/locales/bot-messages.it.json';
import ptMessages from '../i18n/locales/bot-messages.pt.json';
import ukMessages from '../i18n/locales/bot-messages.uk.json';
import faMessages from '../i18n/locales/bot-messages.fa.json';
import idMessages from '../i18n/locales/bot-messages.id.json';
import uzMessages from '../i18n/locales/bot-messages.uz.json';
import { PrismaService } from '../database/prisma.service';

/** Supported bot-reply languages (extend by adding locale JSON files). */
export type BotLanguage =
  'en' | 'tr' | 'de' | 'ru' | 'es' | 'az' | 'ar' | 'fr' | 'it' | 'pt' | 'uk' | 'fa' | 'id' | 'uz';

/** Every supported language code, in /setlang display order. */
export const BOT_LANGUAGES: readonly BotLanguage[] = [
  'en',
  'tr',
  'de',
  'ru',
  'es',
  'az',
  'ar',
  'fr',
  'it',
  'pt',
  'uk',
  'fa',
  'id',
  'uz',
];

/** Flat "a.b.c" -> value lookup tree. */
type MessageTree = Record<string, unknown>;

const LOCALES: Record<BotLanguage, MessageTree> = {
  en: enMessages as MessageTree,
  tr: trMessages as MessageTree,
  de: deMessages as MessageTree,
  ru: ruMessages as MessageTree,
  es: esMessages as MessageTree,
  az: azMessages as MessageTree,
  ar: arMessages as MessageTree,
  fr: frMessages as MessageTree,
  it: itMessages as MessageTree,
  pt: ptMessages as MessageTree,
  uk: ukMessages as MessageTree,
  fa: faMessages as MessageTree,
  id: idMessages as MessageTree,
  uz: uzMessages as MessageTree,
};

/** Cache entry for a chat's resolved language. */
interface LanguageCacheEntry {
  language: BotLanguage;
  cachedAt: number;
}

/**
 * Server-side i18n for bot-facing messages (the reference bot's /setlang parity). All new
 * module runtimes route their fixed strings through `t()`; user-configurable
 * templates (welcome text, notes, ...) remain language-independent. The
 * per-chat language lives in `chat_module_settings` under the `language`
 * module key with fallback to English.
 */
@Injectable()
export class BotI18nService {
  private readonly cache = new Map<string, LanguageCacheEntry>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Translates a key for a language with `{param}` interpolation. Falls back
   * to English, then to the raw key, so a missing translation never crashes.
   *
   * @param {BotLanguage} lang - Target language.
   * @param {string} key - Dot-separated message key (e.g. "restrictions.banned").
   * @param {Record<string, string | number>} [params] - Interpolation values.
   * @returns {string} Localized (HTML-safe-context) message.
   */
  t(lang: BotLanguage, key: string, params?: Record<string, string | number>): string {
    let text = this.lookup(LOCALES[lang] ?? LOCALES.en, key) ?? this.lookup(LOCALES.en, key) ?? key;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
    }
    return text;
  }

  /**
   * Reads a chat's effective bot language (shortly cached).
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @returns {Promise<BotLanguage>} Resolved language ('en' fallback).
   */
  async getChatLanguage(botId: string, chatId: string | number): Promise<BotLanguage> {
    const key = `${botId}:${chatId}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.cachedAt < 30_000) {
      return cached.language;
    }
    const row = await this.prisma.chatModuleSetting
      .findUnique({
        where: {
          botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey: 'language' },
        },
      })
      .catch(() => null);
    const raw = row?.configJson
      ? (JSON.parse(row.configJson) as { language?: unknown }).language
      : undefined;
    const language: BotLanguage = this.normalizeLanguage(raw);
    this.cache.set(key, { language, cachedAt: Date.now() });
    return language;
  }

  /**
   * Persists a chat's language choice and refreshes the cache.
   *
   * @param {number} botId - Studio bot id.
   * @param {string | number} chatId - Telegram chat id.
   * @param {BotLanguage} language - Chosen language.
   * @returns {Promise<void>} Resolves once stored.
   */
  async setChatLanguage(
    botId: string,
    chatId: string | number,
    language: BotLanguage,
  ): Promise<void> {
    await this.prisma.chatModuleSetting.upsert({
      where: { botId_chatId_moduleKey: { botId, chatId: String(chatId), moduleKey: 'language' } },
      create: {
        botId,
        chatId: String(chatId),
        moduleKey: 'language',
        configJson: JSON.stringify({ language }),
      },
      update: { configJson: JSON.stringify({ language }) },
    });
    this.cache.set(`${botId}:${chatId}`, { language, cachedAt: Date.now() });
  }

  /**
   * Drops cached language entries (all, or one chat).
   *
   * @param {number} [botId] - Optional bot filter.
   * @returns {void}
   */
  invalidate(botId?: string): void {
    if (botId === undefined) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${botId}:`)) this.cache.delete(key);
    }
  }

  /**
   * Coerces an arbitrary config value into a supported language code.
   *
   * @param {unknown} raw - Raw stored value.
   * @returns {BotLanguage} Supported language or 'en'.
   */
  private normalizeLanguage(raw: unknown): BotLanguage {
    const value = String(raw ?? '').toLowerCase();
    return (BOT_LANGUAGES as readonly string[]).includes(value) ? (value as BotLanguage) : 'en';
  }

  /**
   * Walks a dot-separated key through a message tree.
   *
   * @param {MessageTree} tree - Locale tree.
   * @param {string} key - Dot-separated key.
   * @returns {string | undefined} Message when found.
   */
  private lookup(tree: MessageTree, key: string): string | undefined {
    let node: unknown = tree;
    for (const part of key.split('.')) {
      if (node === null || typeof node !== 'object') return undefined;
      node = (node as MessageTree)[part];
    }
    return typeof node === 'string' ? node : undefined;
  }
}
