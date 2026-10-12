/**
 * Server-side catalog of every toggleable bot module. The client dashboard
 * mirrors this list with field definitions and documentation content.
 * @module bot-engine/module-registry
 */

/**
 * Static definition of a toggleable module.
 * @interface ModuleDefinition
 * @property {string} key - Stable unique identifier persisted in `bot_modules`.
 * @property {string} name - Human-readable module name.
 * @property {string} category - Presentation grouping (e.g. Communication & CRM).
 * @property {string} description - Short business description.
 * @property {Record<string, unknown>} defaultConfig - Defaults merged on read.
 */
export interface ModuleDefinition {
  key: string;
  name: string;
  category: string;
  description: string;
  defaultConfig: Record<string, unknown>;
}

/**
 * The full module catalog (20 toggleable modules).
 * @type {readonly ModuleDefinition[]}
 */
export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  {
    key: 'connections',
    name: 'Chat Connections',
    category: 'Directory & Content',
    description:
      'Central address book of the groups and channels the bot operates in; every target-chat picker across the studio is powered from this list.',
    defaultConfig: {},
  },
  {
    key: 'start-menu',
    name: 'Start Menu',
    category: 'Directory & Content',
    description:
      'Unified /start menu: chat folder (addlist), channel, group, and web buttons with sections, layout control, click analytics, and a /menu re-open command.',
    defaultConfig: {
      menuStyle: 'flat',
      startMessage: 'Welcome {first_name}. Choose a destination:',
      buttonsPerRow: 1,
      enableMenuCommand: true,
      trackClicks: true,
      publicBaseUrl: '',
    },
  },
  {
    key: 'scheduler',
    name: 'Channel Post Scheduler & Watermark',
    category: 'Directory & Content',
    description:
      'Schedules future channel posts with inline buttons and branded caption watermarking.',
    defaultConfig: { watermarkText: '', timezoneOffsetMinutes: 0 },
  },
  {
    key: 'support',
    name: 'Forum Topics Support Desk',
    category: 'Communication & CRM',
    description:
      'Relays user messages into a dedicated forum topic per user inside an admin supergroup with two-way sync.',
    defaultConfig: {
      adminChatId: 0,
      welcomeText: 'Your message has been delivered to our support team.',
      autoReplyThrottleMinutes: 60,
    },
  },
  {
    key: 'business',
    name: 'Telegram Business Secretary',
    category: 'Communication & CRM',
    description:
      'Automatically answers client messages arriving through a Telegram Business connection.',
    defaultConfig: { connectionId: '', autoReplyText: '' },
  },
  {
    key: 'drip',
    name: 'Drip Marketing Sequences',
    category: 'Communication & CRM',
    description:
      'Timed multi-step message sequences (welcome, onboarding, promotional follow-ups).',
    defaultConfig: { subscribeOnStart: false },
  },
  {
    key: 'broadcast',
    name: 'Enterprise Broadcast Engine',
    category: 'Communication & CRM',
    description:
      'Mass messaging with audience filters, rich media, inline buttons, and 429-aware rate limiting.',
    defaultConfig: { rateLimitPerSecond: 20, pauseBetweenBatchesMs: 1000 },
  },
  {
    key: 'crm',
    name: 'Audience CRM & Segmentation',
    category: 'Communication & CRM',
    description:
      'Subscriber profiles, tags, internal notes, search, and CSV/JSON export.',
    defaultConfig: {},
  },
  {
    key: 'welcome',
    name: 'Group Welcome & Clean Chat',
    category: 'Community & Moderation',
    description:
      'Greets new group members with placeholder templates and auto-cleans join service messages.',
    defaultConfig: {
      template: 'Welcome {mention} to {group_name}!',
      autoDeleteSeconds: 0,
      deleteServiceMessages: true,
      deleteLeaveMessages: false,
    },
  },
  {
    key: 'captcha',
    name: 'Captcha Gatekeeper',
    category: 'Community & Moderation',
    description:
      'Button or math verification gate for new members with automated kick timers (anti-raid).',
    defaultConfig: {
      mode: 'button',
      timeoutSeconds: 120,
      kickOnFail: true,
      successText: 'Verification successful. Enjoy the community.',
    },
  },
  {
    key: 'moderation',
    name: 'Automated Moderation & Anti-Spam',
    category: 'Community & Moderation',
    description:
      'Blacklisted words (string/regex), link blocking, and flood control with strike escalation.',
    defaultConfig: {
      blockedWords: [],
      blockLinks: false,
      floodMessageLimit: 0,
      floodWindowSeconds: 10,
      autoBanAfterStrikes: 3,
    },
  },
  {
    key: 'giveaways',
    name: 'Giveaways & Contest Engine',
    category: 'Community & Moderation',
    description:
      'Giveaways requiring channel membership with verifiable winner selection.',
    defaultConfig: { announceWinners: true },
  },
  {
    key: 'referrals',
    name: 'Affiliate & Referral Leaderboard',
    category: 'Community & Moderation',
    description:
      'Deep-link referral tracking with point rewards and a public leaderboard.',
    defaultConfig: { pointsPerReferral: 10, leaderboardSize: 10 },
  },
  {
    key: 'quizzes',
    name: 'Interactive Quizzes & Polls',
    category: 'Community & Moderation',
    description:
      'Timed trivia quizzes delivered via sendPoll with persistent scoreboards.',
    defaultConfig: { defaultCommand: 'quiz' },
  },
  {
    key: 'reactions',
    name: 'Reaction Analytics & Gamification',
    category: 'Community & Moderation',
    description:
      'Tracks emoji reactions on channel posts and rewards active members with points.',
    defaultConfig: { pointsPerReaction: 1 },
  },
  {
    key: 'ai-assistant',
    name: 'AI Knowledge Assistant',
    category: 'Automation & Monetization',
    description:
      '24/7 AI answering powered by OpenAI or Gemini with a configurable enterprise system prompt.',
    defaultConfig: {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini',
      systemPrompt:
        'You are a professional customer support assistant. Answer concisely, accurately, and politely. Never invent facts. Reply in the language of the user.',
      maxTokens: 600,
      historyLimit: 6,
    },
  },
  {
    key: 'autoresponder',
    name: 'Custom Commands & Auto-Responder',
    category: 'Automation & Monetization',
    description:
      'Custom commands (/pricing, /faq) and keyword trigger rules with media support.',
    defaultConfig: { startMessage: '' },
  },
  {
    key: 'paid-media',
    name: 'Paid Media Paywall',
    category: 'Automation & Monetization',
    description:
      'Locks photos and videos behind Telegram Stars paywalls via sendPaidMedia.',
    defaultConfig: { starCount: 25, protectCaption: true },
  },
  {
    key: 'vip-subs',
    name: 'VIP Channel Subscriptions',
    category: 'Automation & Monetization',
    description:
      'Star-based recurring invite links with automatic removal of expired members.',
    defaultConfig: { channelChatId: 0, subscriptionPeriodDays: 30, starPrice: 50 },
  },
  {
    key: 'webhooks',
    name: 'Webhooks Hub',
    category: 'Automation & Monetization',
    description:
      'Outgoing signed event webhooks (Zapier, Make, n8n) and inbound automation triggers.',
    defaultConfig: {},
  },
];

/**
 * Looks up a module definition by key.
 * @param {string} key - Module identifier.
 * @returns {ModuleDefinition | undefined} Definition when the key exists.
 */
export function findModule(key: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find((module) => module.key === key);
}
