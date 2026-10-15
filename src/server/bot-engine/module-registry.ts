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
 * The full module catalog (21 toggleable modules).
 * @type {readonly ModuleDefinition[]}
 */
export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  {
    key: 'connections',
    name: 'Chat Connections',
    category: 'Directory & Content',
    description:
      'Central address book of the groups and channels the bot operates in; every target-chat picker across the studio is powered from this list.',
    defaultConfig: { autoSync: true },
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
      'Mass messaging with audience filters, rich media, inline buttons, 429-aware rate limiting, A/B variant experiments, and click-through tracking.',
    defaultConfig: {
      rateLimitPerSecond: 20,
      pauseBetweenBatchesMs: 1000,
      batchSize: 30,
      trackClicks: false,
      publicBaseUrl: '',
    },
  },
  {
    key: 'media-library',
    name: 'Shared Media Library',
    category: 'Directory & Content',
    description:
      'Reusable URL and Telegram file_id assets for every media-capable composer (welcome, broadcast, drip, autoresponder, scheduler) with a one-click picker.',
    defaultConfig: {},
  },
  {
    key: 'inline-mode',
    name: 'Inline Mode Answers',
    category: 'Automation & Monetization',
    description:
      'Answers @bot queries in any chat with saved quick answers and an optional AI-generated answer (requires inline mode enabled in @BotFather).',
    defaultConfig: {
      suggestions: [],
      enableAi: false,
      cacheSeconds: 30,
    },
  },
  {
    key: 'flows',
    name: 'Visual Flow Builder',
    category: 'Automation & Monetization',
    description:
      'Multi-step conversation flows started by commands, keywords, or /start: message, input, condition, delay, and tag nodes with per-user sessions and sandbox testing.',
    defaultConfig: {},
  },
  {
    key: 'crm',
    name: 'Audience CRM & Segmentation',
    category: 'Communication & CRM',
    description: 'Subscriber profiles, tags, internal notes, search, and CSV/JSON export.',
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
      welcomeEnabled: true,
      autoDeleteSeconds: 0,
      cleanWelcome: false,
      mediaUrl: '',
      buttonsJson: '',
      goodbyeEnabled: false,
      goodbyeText: 'Nice knowing you, {first_name}!',
      goodbyeMediaUrl: '',
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
      buttonText: 'Verify',
      joinRequestIntegration: false,
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
    key: 'group-moderation',
    name: 'Group Moderation Commands',
    category: 'Community & Moderation',
    description:
      'In-group admin commands: ban/mute/kick with timed, delete and silent variants, persistent warnings, purges, and approvals.',
    defaultConfig: {
      warnLimit: 3,
      warnMode: 'ban',
      warnDurationSeconds: 0,
      warnTimeSeconds: 0,
      silentActions: false,
      adminError: true,
    },
  },
  {
    key: 'group-tools',
    name: 'Group Admin Tools',
    category: 'Community & Moderation',
    description:
      'Pins (incl. permapin), user reports (@admin), admin list, /id and /info lookups, echo, and per-group command disabling.',
    defaultConfig: {
      reportsEnabled: true,
      antichannelPins: false,
      cleanLinked: false,
    },
  },
  {
    key: 'locks',
    name: 'Chat Locks',
    category: 'Community & Moderation',
    description:
      'Fine-grained content locks: block stickers, gifs, polls, forwards, links, media types and more, with allowlists and custom punishments.',
    defaultConfig: {
      lockedTypes: [],
      lockWarns: false,
      allowlist: [],
    },
  },
  {
    key: 'antiraid',
    name: 'AntiRaid',
    category: 'Community & Moderation',
    description:
      'Temporarily bans every new joiner during raid attacks, manually or automatically when join rates spike.',
    defaultConfig: {
      raidTimeSeconds: 21_600,
      raidActionTimeSeconds: 3_600,
      autoRaidJoinThreshold: 0,
    },
  },
  {
    key: 'rules',
    name: 'Group Rules',
    category: 'Community & Moderation',
    description:
      'Per-group rules with /rules delivery via PM buttons and the {rules} template placeholder.',
    defaultConfig: {
      rulesText: '',
      privateRules: true,
      rulesButton: 'Rules',
    },
  },
  {
    key: 'admin-log',
    name: 'Admin Log Channel',
    category: 'Community & Moderation',
    description:
      'Forwards admin actions, automated punishments, settings changes and reports to a Telegram log channel with category filters.',
    defaultConfig: {
      logChatId: 0,
      categories: ['settings', 'admin', 'user', 'automated', 'reports', 'other'],
    },
  },
  {
    key: 'cleaning',
    name: 'Message Cleaning',
    category: 'Community & Moderation',
    description:
      "Auto-deletes used commands, Telegram service messages (joins, pins, titles), and the bot's own action messages.",
    defaultConfig: {
      cleanCommand: 'off',
      cleanServiceTypes: [],
      cleanBotMessages: 'off',
    },
  },
  {
    key: 'topics',
    name: 'Forum Topic Management',
    category: 'Community & Moderation',
    description:
      'Create, rename, close, reopen and delete forum topics from chat commands, plus routing bot messages to an action topic.',
    defaultConfig: {
      actionTopicId: 0,
    },
  },
  {
    key: 'federation',
    name: 'Ban Federations',
    category: 'Community & Moderation',
    description:
      "Shared ban lists across all of your bots' groups: /fban removes users everywhere, with fed admins, logs, and subscriptions.",
    defaultConfig: {
      quietFed: false,
      fedNotif: true,
      fedReasonRequired: false,
    },
  },
  {
    key: 'language',
    name: 'Bot Reply Language',
    category: 'Community & Moderation',
    description:
      'Per-group bot reply language (/setlang) for every moderation and system message the bot sends.',
    defaultConfig: {
      language: 'en',
    },
  },
  {
    key: 'bot2bot',
    name: 'Bot-to-Bot Commands',
    category: 'Automation & Monetization',
    description:
      "Lets other bots use this bot's group commands (off / admin-bots-only / all) with an admin review safety gate.",
    defaultConfig: {
      mode: 'off',
      skipReview: false,
    },
  },
  {
    key: 'giveaways',
    name: 'Giveaways & Contest Engine',
    category: 'Community & Moderation',
    description: 'Giveaways requiring channel membership with verifiable winner selection.',
    defaultConfig: { announceWinners: true },
  },
  {
    key: 'referrals',
    name: 'Affiliate & Referral Leaderboard',
    category: 'Community & Moderation',
    description: 'Deep-link referral tracking with point rewards and a public leaderboard.',
    defaultConfig: { pointsPerReferral: 10, leaderboardSize: 10 },
  },
  {
    key: 'quizzes',
    name: 'Interactive Quizzes & Polls',
    category: 'Community & Moderation',
    description: 'Timed trivia quizzes delivered via sendPoll with persistent scoreboards.',
    defaultConfig: { defaultCommand: 'quiz' },
  },
  {
    key: 'reactions',
    name: 'Reaction Analytics & Gamification',
    category: 'Community & Moderation',
    description: 'Tracks emoji reactions on channel posts and rewards active members with points.',
    defaultConfig: { pointsPerReaction: 1 },
  },
  {
    key: 'message-score',
    name: 'Message Score & Activity Leaderboard',
    category: 'Community & Moderation',
    description:
      'Scores group member activity (messages, replies, media), publishes rich leaderboards to one or many chats, fully schedulable.',
    defaultConfig: { messageWeight: 1, replyWeight: 1, mediaWeight: 2 },
  },
  {
    key: 'ai-assistant',
    name: 'AI Knowledge Assistant',
    category: 'Automation & Monetization',
    description:
      '24/7 AI answering via OpenAI, Gemini, or any OpenAI-compatible URL (OpenRouter, DeepSeek, Ollama, ...) with a configurable enterprise system prompt.',
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
    description: 'Custom commands (/pricing, /faq) and keyword trigger rules with media support.',
    defaultConfig: { startMessage: '' },
  },
  {
    key: 'paid-media',
    name: 'Paid Media Paywall',
    category: 'Automation & Monetization',
    description: 'Locks photos and videos behind Telegram Stars paywalls via sendPaidMedia.',
    defaultConfig: { starCount: 25, protectCaption: true },
  },
  {
    key: 'vip-subs',
    name: 'VIP Channel Subscriptions',
    category: 'Automation & Monetization',
    description: 'Star-based recurring invite links with automatic removal of expired members.',
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
