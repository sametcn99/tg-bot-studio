/**
 * Client-side module catalog mirroring the server MODULE_REGISTRY. Carries
 * the dashboard page type, configuration field definitions, CRUD resource
 * descriptors, and the per-module documentation shown in help dialogs.
 * @module registry/modules
 */

/**
 * Configuration field definition rendered by the generic config page.
 * @interface ConfigField
 * @property {string} key - Config object key.
 * @property {string} label - Display label.
 * @property {'text'|'number'|'switch'|'select'|'textarea'|'stringList'|'password'|'chatSelect'} type - Widget type.
 * @property {string[]} [options] - Choices for select fields.
 * @property {string} [help] - Tooltip text.
 * @property {string[]} [connectionTypes] - Connection type filter for chatSelect fields.
 */
export interface ConfigField {
  key: string;
  label: string;
  type:
    'text' | 'number' | 'switch' | 'select' | 'textarea' | 'stringList' | 'password' | 'chatSelect';
  options?: string[];
  help?: string;
  connectionTypes?: string[];
}

/**
 * CRUD column descriptor for table pages.
 * @interface CrudColumn
 * @property {string} key - Row property key.
 * @property {string} label - Column header.
 * @property {string} [type] - Rendering hint (`bool` renders a status chip).
 */
export interface CrudColumn {
  key: string;
  label: string;
  type?: 'bool' | 'text' | 'number';
}

/**
 * CRUD form field descriptor for table pages.
 * @interface CrudField
 * @property {string} key - Payload key sent to the API.
 * @property {string} label - Display label.
 * @property {'text'|'number'|'textarea'|'datetime'|'json'|'stringList'|'select'|'chatSelect'|'chatMultiSelect'} type - Widget type.
 * @property {string[]} [options] - Choices for `select` fields.
 * @property {string} [help] - Tooltip text.
 * @property {string[]} [connectionTypes] - Connection type filter for chat pickers.
 */
export interface CrudField {
  key: string;
  label: string;
  type:
    | 'text'
    | 'number'
    | 'textarea'
    | 'datetime'
    | 'json'
    | 'stringList'
    | 'select'
    | 'chatSelect'
    | 'chatMultiSelect';
  options?: string[];
  help?: string;
  connectionTypes?: string[];
}

/**
 * CRUD resource descriptor for table pages.
 * @interface CrudResource
 * @property {string} endpoint - Bot-scoped REST endpoint (without /api prefix).
 * @property {CrudColumn[]} columns - Table columns.
 * @property {CrudField[]} formFields - Create/edit dialog fields.
 * @property {Record<string, unknown>} initialForm - Blank form values.
 */
export interface CrudResource {
  endpoint: string;
  columns: CrudColumn[];
  formFields: CrudField[];
  initialForm: Record<string, unknown>;
}

/**
 * Dashboard page type dispatching for a module.
 * @typedef {'config'|'crud'|'broadcast'|'crm'|'support'|'monetization'|'webhooks'|'engagement'|'referrals'|'connections'|'message-score'} ModulePageType
 */
export type ModulePageType =
  | 'config'
  | 'crud'
  | 'broadcast'
  | 'crm'
  | 'support'
  | 'monetization'
  | 'webhooks'
  | 'engagement'
  | 'referrals'
  | 'connections'
  | 'message-score';

/**
 * Client module catalog entry.
 * @interface ModuleEntry
 * @property {string} key - Module registry key.
 * @property {string} name - Display name.
 * @property {string} category - Sidebar grouping.
 * @property {string} description - Short business description.
 * @property {ModulePageType} pageType - Dashboard page dispatcher.
 * @property {ConfigField[]} [configFields] - Fields for `config` pages.
 * @property {CrudResource} [crud] - Resource descriptor for `crud` pages.
 * @property {{overview: string[]; setup: string[]; troubleshooting: string[]}} docs - Help dialog content.
 */
export interface ModuleEntry {
  key: string;
  name: string;
  category: string;
  description: string;
  pageType: ModulePageType;
  configFields?: ConfigField[];
  crud?: CrudResource;
  docs: {
    overview: string[];
    setup: string[];
    troubleshooting: string[];
  };
}

/**
 * The placeholder dictionary shared by every messaging module.
 * @type {Array<{tag: string; description: string}>}
 */
export const PLACEHOLDERS: Array<{ tag: string; description: string }> = [
  { tag: '{first_name}', description: "User's Telegram first name" },
  { tag: '{last_name}', description: "User's Telegram last name" },
  { tag: '{username}', description: "User's @username without the @" },
  { tag: '{user_id}', description: 'Numeric Telegram user id' },
  { tag: '{mention}', description: 'Clickable mention link for the user' },
  { tag: '{group_name}', description: 'Title of the group or channel' },
  { tag: '{bot_name}', description: 'Display name of the bot' },
  { tag: '{date}', description: 'Current date (ISO)' },
  { tag: '{time}', description: 'Current UTC time (HH:mm)' },
];

/** The 20-module catalog consumed by navigation, toggles, and pages. */
export const MODULES: ModuleEntry[] = [
  {
    key: 'connections',
    name: 'Chat Connections',
    category: 'Directory & Content',
    description:
      'Central address book of your groups and channels; target pickers across every module are powered from this list.',
    pageType: 'connections',
    docs: {
      overview: [
        'Register each group, supergroup, and channel the bot operates in once — every target-chat field in the studio then offers them as a dropdown.',
        'Chats the bot is added to are discovered automatically; Sync imports them with their titles and types.',
        'Connections accept numeric ids (-100…) or public @usernames, and can be deactivated without deletion.',
      ],
      setup: [
        'Add the bot to the target group or channel as an administrator (posting rights are enough for channels).',
        'Press Sync to import chats the bot already discovered, or add entries manually with their chat id or @username.',
        'Reference the same list from the Scheduler, Support Desk, Giveaways, VIP Subscriptions, Paid Media, and Webhooks modules.',
      ],
      troubleshooting: [
        'A numeric chat id is required for private chats; @usernames only work for public channels and groups.',
        'Sync only knows chats where the bot received at least one update (my_chat_member events).',
        'Removing a connection never kicks the bot; it only removes the studio-side shortcut.',
      ],
    },
  },
  {
    key: 'start-menu',
    name: 'Start Menu',
    category: 'Directory & Content',
    description:
      'Unified /start menu: chat folder (addlist), channel, group, and web buttons with sections, layout control, click analytics, and /menu re-open.',
    pageType: 'crud',
    configFields: [
      {
        key: 'menuStyle',
        label: 'Menu style',
        type: 'select',
        options: ['flat', 'categorized'],
        help: 'Flat shows one button list; categorized groups destinations with headers',
      },
      {
        key: 'startMessage',
        label: 'Start message',
        type: 'textarea',
        help: 'Supports placeholders such as {first_name} and {mention}',
      },
      {
        key: 'buttonsPerRow',
        label: 'Buttons per row',
        type: 'number',
        help: 'Inline button columns, 1-4',
      },
      {
        key: 'enableMenuCommand',
        label: 'Enable /menu command',
        type: 'switch',
        help: 'Users can re-open the menu anytime with /menu',
      },
      { key: 'trackClicks', label: 'Track clicks via redirect', type: 'switch' },
      {
        key: 'publicBaseUrl',
        label: 'Public base URL',
        type: 'text',
        help: 'Required for click tracking, e.g. https://studio.example.com',
      },
    ],
    crud: {
      endpoint: '/bots/{botId}/menu-items',
      columns: [
        { key: 'title', label: 'Title' },
        { key: 'type', label: 'Type' },
        { key: 'url', label: 'URL' },
        { key: 'order_index', label: 'Order', type: 'number' },
        { key: 'click_count', label: 'Clicks', type: 'number' },
        { key: 'is_active', label: 'Active', type: 'bool' },
      ],
      formFields: [
        { key: 'title', label: 'Title', type: 'text' },
        {
          key: 'type',
          label: 'Type',
          type: 'select',
          options: ['folder', 'channel', 'group', 'link'],
          help: 'folder = chat folder (t.me/addlist/...) share link',
        },
        { key: 'url', label: 'URL', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'orderIndex', label: 'Order', type: 'number' },
      ],
      initialForm: { title: '', type: 'link', url: '', description: '', orderIndex: 0 },
    },
    docs: {
      overview: [
        'The consolidated start menu: every destination your bot offers on /start lives here — chat folder share links (t.me/addlist/...), channels, groups, and external web links.',
        'Flat style renders one button list; categorized style groups destinations by type with section headers in the message text.',
        'Button layout is controlled per row (1-4 columns) and users can re-open the menu anytime with /menu.',
        'Click counters quantify engagement per menu item when tracking is enabled.',
      ],
      setup: [
        'In Telegram, create a chat folder and use its share link (t.me/addlist/...) as a menu item of type folder.',
        'Add channels, groups, and web destinations as items of their matching type; order controls button position.',
        'Set a start message with placeholders ({first_name}, {mention}) for a personalized header.',
        'Optionally set a public base URL to route buttons through the built-in click tracker.',
        'Send /start (or /menu) to the bot to verify the menu renders.',
      ],
      troubleshooting: [
        'Click tracking requires the studio to be reachable on a public HTTPS URL.',
        'Telegram caches inline keyboards briefly; edits apply to newly sent menus.',
        'When both this module and Custom Commands define a /start reply, the Start Menu takes priority.',
      ],
    },
  },
  {
    key: 'scheduler',
    name: 'Channel Post Scheduler',
    category: 'Directory & Content',
    description: 'Timed channel posts with inline buttons and caption watermark.',
    pageType: 'crud',
    configFields: [
      {
        key: 'watermarkText',
        label: 'Watermark text',
        type: 'text',
        help: 'Appended to every scheduled caption',
      },
      {
        key: 'timezoneOffsetMinutes',
        label: 'Timezone offset (minutes, e.g. 180 for UTC+3)',
        type: 'number',
        help: 'Local time offset for {date} and {time} placeholders and scheduling',
      },
    ],
    crud: {
      endpoint: '/bots/{botId}/scheduler/posts',
      columns: [
        { key: 'target_chat_id', label: 'Target chat' },
        { key: 'message_text', label: 'Message' },
        { key: 'scheduled_at', label: 'Scheduled at' },
        { key: 'status', label: 'Status' },
      ],
      formFields: [
        {
          key: 'targetChatId',
          label: 'Target chat',
          type: 'chatSelect',
          help: 'Pick a connected channel or group; manage the list in Chat Connections',
        },
        { key: 'messageText', label: 'Message text', type: 'textarea' },
        { key: 'mediaUrl', label: 'Media URL (photo/video)', type: 'text' },
        {
          key: 'buttons',
          label: 'Buttons (JSON array)',
          type: 'json',
          help: '[{"text":"Open","url":"https://..."}]',
        },
        { key: 'scheduledAt', label: 'Dispatch at (UTC ISO)', type: 'datetime' },
      ],
      initialForm: {
        targetChatId: '',
        messageText: '',
        mediaUrl: '',
        buttons: '',
        scheduledAt: '',
      },
    },
    docs: {
      overview: [
        'Queue posts to channels with precise dispatch times, rich media, and inline buttons.',
        'A branded watermark line is appended to captions for consistent channel identity.',
      ],
      setup: [
        'Add the bot as an administrator in the target channel with permission to post.',
        'Copy the channel id (@username or numeric) into the post form.',
        'Schedule posts; the dispatcher checks every 30 seconds.',
      ],
      troubleshooting: [
        'Posts fail with 400 when the bot lacks admin rights in the target chat.',
        'Times are stored and compared in UTC ISO format.',
      ],
    },
  },
  {
    key: 'support',
    name: 'Support Desk (Livegram)',
    category: 'Communication & CRM',
    description: 'Per-user forum topics in an admin supergroup with two-way relay.',
    pageType: 'config',
    configFields: [
      {
        key: 'adminChatId',
        label: 'Admin supergroup',
        type: 'chatSelect',
        connectionTypes: ['supergroup', 'group'],
        help: 'Forum-enabled admin group; manage the list in Chat Connections',
      },
      { key: 'welcomeText', label: 'Auto-reply text', type: 'textarea' },
      { key: 'autoReplyThrottleMinutes', label: 'Auto-reply throttle (minutes)', type: 'number' },
    ],
    docs: {
      overview: [
        'Every user message opens a dedicated forum topic in your admin supergroup.',
        'Admins reply inside the topic; the bot relays the answer to the user.',
        'Quick commands: /ban, /unban, /info while replying in a topic.',
      ],
      setup: [
        'Create a supergroup, enable Topics in its settings, and add the bot as an admin.',
        'Copy the supergroup id into the configuration and save.',
        'Users message the bot directly; topics appear automatically.',
      ],
      troubleshooting: [
        'Topic creation requires the bot to be an administrator with can_manage_topics.',
        'The auto-reply is throttled per user to avoid spamming receipts.',
      ],
    },
  },
  {
    key: 'business',
    name: 'Business Secretary',
    category: 'Communication & CRM',
    description: 'Auto-answers clients writing to a Telegram Business account.',
    pageType: 'config',
    configFields: [
      {
        key: 'connectionId',
        label: 'Business connection id',
        type: 'text',
        help: 'Leave empty to answer every connection',
      },
      { key: 'autoReplyText', label: 'Auto-reply text', type: 'textarea' },
    ],
    docs: {
      overview: [
        'Handles messages arriving through a manager personal Telegram Business connection.',
        'Useful for after-hours acknowledgements and triage outside working time.',
      ],
      setup: [
        'In Telegram Business settings, connect the bot to the manager account.',
        'Copy the emitted business_connection_id into the configuration.',
        'Write a concise, professional auto-reply and enable the module.',
      ],
      troubleshooting: [
        'Business message APIs evolve; replies are sent through the raw Bot API surface.',
        'If replies fail, verify the connection is still active in Telegram settings.',
      ],
    },
  },
  {
    key: 'drip',
    name: 'Drip Sequences',
    category: 'Communication & CRM',
    description: 'Timed multi-step sequences such as onboarding journeys.',
    pageType: 'crud',
    configFields: [{ key: 'subscribeOnStart', label: 'Auto-subscribe on /start', type: 'switch' }],
    crud: {
      endpoint: '/bots/{botId}/drip/campaigns',
      columns: [
        { key: 'name', label: 'Campaign' },
        { key: 'subscribers', label: 'Subscribers', type: 'number' },
        { key: 'is_active', label: 'Active', type: 'bool' },
      ],
      formFields: [
        { key: 'name', label: 'Campaign name', type: 'text' },
        {
          key: 'steps',
          label: 'Steps (JSON)',
          type: 'json',
          help: '[{"delayMinutes":60,"text":"Welcome {first_name}"}]',
        },
      ],
      initialForm: { name: '', steps: '' },
    },
    docs: {
      overview: [
        'Classic day-1/day-3/day-7 onboarding and promotional journeys.',
        'Each step delays a configurable number of minutes after the previous one.',
        'Subscribers can be added manually or automatically on /start.',
      ],
      setup: [
        'Create a campaign with at least one step (delayMinutes + text).',
        'Enable auto-subscribe on start or add subscribers from the campaign view.',
        'The scheduler advances steps every 30 seconds.',
      ],
      troubleshooting: [
        'Users who blocked the bot are unsubscribed automatically on delivery failure.',
        'delayMinutes counts from the previous step, not from subscription.',
      ],
    },
  },
  {
    key: 'broadcast',
    name: 'Broadcast Engine',
    category: 'Communication & CRM',
    description: 'Filtered mass messaging with 429-aware rate limiting.',
    pageType: 'broadcast',
    docs: {
      overview: [
        'Send announcements to everyone, a language segment, or recently active users.',
        'Rich media and inline buttons are supported with per-recipient placeholders.',
        'Success and failure counters update live while the queue drains.',
      ],
      setup: [
        'Grow the audience first: every user who messages the bot is recorded.',
        'Compose the broadcast, choose a target filter, and queue it.',
        'Monitor progress in the history table.',
      ],
      troubleshooting: [
        'Telegram limits broadcasts to ~30 messages per second; the engine paces below that.',
        'Users who blocked the bot count as failures and are skipped in spirit by future targeting.',
      ],
    },
  },
  {
    key: 'crm',
    name: 'Audience CRM',
    category: 'Communication & CRM',
    description: 'Subscriber profiles, tags, notes, and CSV/JSON export.',
    pageType: 'crm',
    docs: {
      overview: [
        'Every bot interaction upserts a subscriber profile automatically.',
        'Tag users into segments (VIP, beta, churn-risk) and keep internal notes.',
        'Export the full audience as CSV or JSON for external tooling.',
      ],
      setup: [
        'No setup required; profiles accumulate as the bot runs.',
        'Use tags as broadcast filters and segmentation hooks.',
      ],
      troubleshooting: [
        'Search matches username, name, and Telegram id.',
        'Points shown here feed the referral and gamification modules.',
      ],
    },
  },
  {
    key: 'welcome',
    name: 'Welcome & Clean Chat',
    category: 'Community & Moderation',
    description: 'New-member greetings with auto-delete and service message cleanup.',
    pageType: 'config',
    configFields: [
      { key: 'template', label: 'Welcome template', type: 'textarea' },
      {
        key: 'autoDeleteSeconds',
        label: 'Auto-delete after seconds (15-120, 0 = off)',
        type: 'number',
      },
      { key: 'deleteServiceMessages', label: 'Delete join service messages', type: 'switch' },
      { key: 'deleteLeaveMessages', label: 'Delete leave service messages', type: 'switch' },
    ],
    docs: {
      overview: [
        'Greets every new group member with a templated message and mention link.',
        'Keeps chats clean by removing Telegram join/leave service messages.',
        'Greetings can self-delete after 15 to 120 seconds.',
      ],
      setup: [
        'Disable bot privacy mode via BotFather so the bot sees join events.',
        'Add the bot to the group as an administrator with delete permissions.',
        'Compose the template using placeholders such as {mention} and {group_name}.',
      ],
      troubleshooting: [
        'Without admin rights the bot cannot delete service or greeting messages.',
        'autoDeleteSeconds is clamped to the supported 15-120 range.',
      ],
    },
  },
  {
    key: 'captcha',
    name: 'Captcha Gatekeeper',
    category: 'Community & Moderation',
    description: 'Button or math verification with automatic kick timers.',
    pageType: 'config',
    configFields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['button', 'math'] },
      { key: 'timeoutSeconds', label: 'Timeout (seconds)', type: 'number' },
      { key: 'kickOnFail', label: 'Kick on timeout', type: 'switch' },
      { key: 'successText', label: 'Success message', type: 'text' },
    ],
    docs: {
      overview: [
        'Anti-raid gate: new members must verify within the configured window.',
        'Button mode taps to verify; math mode replies with a sum answer.',
        'Unverified members are kicked (ban + unban) when the timer expires.',
      ],
      setup: [
        'Add the bot as a group administrator with ban permissions.',
        'Choose a mode and timeout, then enable the module.',
      ],
      troubleshooting: [
        'Kicks require administrator rights including can_restrict_members.',
        'Pending challenges live in memory and reset on bot restart.',
      ],
    },
  },
  {
    key: 'moderation',
    name: 'Moderation & Anti-Spam',
    category: 'Community & Moderation',
    description: 'Blacklisted words, link blocking, flood control, strike escalation.',
    pageType: 'config',
    configFields: [
      { key: 'blockedWords', label: 'Blocked words (one per line or /regex/)', type: 'stringList' },
      { key: 'blockLinks', label: 'Block links', type: 'switch' },
      { key: 'floodMessageLimit', label: 'Flood limit (0 = off)', type: 'number' },
      { key: 'floodWindowSeconds', label: 'Flood window (seconds)', type: 'number' },
      { key: 'autoBanAfterStrikes', label: 'Auto-ban after strikes (0 = off)', type: 'number' },
    ],
    docs: {
      overview: [
        'Deletes messages matching blacklisted words (plain or /regex/ form), links, or floods.',
        'Repeat offenders escalate to a studio-level ban and chat kick.',
        'Banned users are listed here for review and manual unbans.',
      ],
      setup: [
        'Grant the bot administrator rights with message deletion.',
        'Tune thresholds conservatively to avoid false positives.',
      ],
      troubleshooting: [
        'Regex entries use the /pattern/flags form, e.g. /\\bfree crypto\\b/i.',
        'Flood windows are per user per group and held in memory.',
      ],
    },
  },
  {
    key: 'giveaways',
    name: 'Giveaways Engine',
    category: 'Community & Moderation',
    description: 'Channel-gated giveaways with verifiable winner draws.',
    pageType: 'crud',
    configFields: [{ key: 'announceWinners', label: 'Message winners', type: 'switch' }],
    crud: {
      endpoint: '/bots/{botId}/giveaways',
      columns: [
        { key: 'title', label: 'Title' },
        { key: 'winners_count', label: 'Winners', type: 'number' },
        { key: 'participants', label: 'Participants', type: 'number' },
        { key: 'ends_at', label: 'Ends at' },
        { key: 'status', label: 'Status' },
      ],
      formFields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'prizeDetails', label: 'Prize details', type: 'textarea' },
        {
          key: 'requiredChannels',
          label: 'Required channels',
          type: 'chatMultiSelect',
          connectionTypes: ['channel'],
          help: 'Membership gates verified on join; manage the list in Chat Connections',
        },
        { key: 'winnersCount', label: 'Winners count', type: 'number' },
        { key: 'endsAt', label: 'Ends at (UTC ISO, empty = manual)', type: 'datetime' },
      ],
      initialForm: {
        title: '',
        prizeDetails: '',
        requiredChannels: [],
        winnersCount: 1,
        endsAt: '',
      },
    },
    docs: {
      overview: [
        'Users join via /giveaway and inline Participate buttons.',
        'Membership in required channels is verified through getChatMember.',
        'Winners are drawn with a seeded shuffle reproducible from the participant list.',
      ],
      setup: [
        'Add the bot as an administrator in every required channel.',
        'Create the giveaway with channel ids and an end time.',
        'Announce /giveaway in your community to start collecting participants.',
      ],
      troubleshooting: [
        'Verification fails when the bot cannot see the channel member list.',
        'Draws run every 60 seconds after ends_at passes.',
      ],
    },
  },
  {
    key: 'referrals',
    name: 'Referral Leaderboard',
    category: 'Community & Moderation',
    description: 'Deep-link referral tracking with point rewards and /top.',
    pageType: 'referrals',
    configFields: [
      { key: 'pointsPerReferral', label: 'Points per referral', type: 'number' },
      { key: 'leaderboardSize', label: 'Leaderboard size', type: 'number' },
    ],
    docs: {
      overview: [
        'Users share t.me/bot?start=ref_<id> deep links; attribution is automatic.',
        'Referrers earn points instantly; /top shows the standing leaderboard.',
      ],
      setup: [
        'Enable the module and configure the reward per referral.',
        'Broadcast the personal link pattern to your community.',
      ],
      troubleshooting: [
        'Self-referrals and repeat attributions are ignored.',
        'The referrer must already be a known subscriber when the invitee arrives.',
      ],
    },
  },
  {
    key: 'quizzes',
    name: 'Quizzes & Polls',
    category: 'Community & Moderation',
    description: 'Timed trivia with persistent scoreboards.',
    pageType: 'engagement',
    configFields: [{ key: 'defaultCommand', label: 'Trigger command', type: 'text' }],
    docs: {
      overview: [
        'sendPoll-powered quizzes with correct answers scored automatically.',
        'Points and per-quiz scoreboards persist for leaderboards (/scoreboard).',
      ],
      setup: [
        'Create quizzes in the engagement tab (question, options, correct index, points).',
        'Users start a random quiz with the configured command.',
      ],
      troubleshooting: [
        'Polls must be non-anonymous for scoring; the module enforces this.',
        'Reactions analytics live in the same engagement tab.',
      ],
    },
  },
  {
    key: 'reactions',
    name: 'Reaction Analytics',
    category: 'Community & Moderation',
    description: 'Tracks channel post reactions and rewards points.',
    pageType: 'engagement',
    configFields: [{ key: 'pointsPerReaction', label: 'Points per reaction', type: 'number' }],
    docs: {
      overview: [
        'Counts emoji reactions on posts and awards points to the reacting member.',
        'The summary chart shows which emojis resonate with the audience.',
      ],
      setup: [
        'Add the bot as an administrator in the tracked channel.',
        'Reaction updates require the chat to permit bot reaction events.',
      ],
      troubleshooting: [
        'Anonymous reactor identities cannot be attributed and are skipped.',
        'Emoji-only reactions are counted; paid and custom reactions are ignored.',
      ],
    },
  },
  {
    key: 'message-score',
    name: 'Message Score & Leaderboard',
    category: 'Community & Moderation',
    description:
      'Scores member activity in groups (messages, replies, media), lists the most active members, and posts rich leaderboards to one or many chats on a schedule.',
    pageType: 'message-score',
    configFields: [
      {
        key: 'messageWeight',
        label: 'Score per message',
        type: 'number',
        help: 'Weight added for every regular member message',
      },
      {
        key: 'replyWeight',
        label: 'Score per reply',
        type: 'number',
        help: 'Extra weight when a member replies to someone else',
      },
      {
        key: 'mediaWeight',
        label: 'Score per media message',
        type: 'number',
        help: 'Weight for photos, videos, stickers, voice, and files',
      },
    ],
    docs: {
      overview: [
        'Every member message in your groups builds a per-day activity record: messages, replies to others, and media count separately.',
        'The weighted score ranks the most active members for any period (today, 7 days, 30 days, or all time).',
        'Rich leaderboard messages (header, per-member row template, footer, medals, parse mode, silent flag) can be sent instantly or on a recurring schedule to one or many connected chats.',
        'Schedules support once, hourly, daily, and weekly recurrences in UTC.',
      ],
      setup: [
        'Disable bot privacy mode via BotFather (or make the bot an admin) so it can see member messages in groups.',
        'Enable the module and tune the score weights in the configuration card.',
        'Pick one or more target chats, design the message format with placeholders, and check the live preview.',
        'Press Send now for a one-off posting, or Save as schedule to automate it.',
      ],
      troubleshooting: [
        'No members on the leaderboard usually means privacy mode is hiding group messages from the bot.',
        'Service messages (joins, pins, title changes) never count towards the score.',
        'Sending fails with 403 when the bot is not a member of the target chat or lacks posting rights.',
        'Scheduled times use UTC; daily/weekly runs fire at the configured HH:mm.',
      ],
    },
  },
  {
    key: 'ai-assistant',
    name: 'AI Assistant',
    category: 'Automation & Monetization',
    description:
      '24/7 AI answering via OpenAI, Gemini, or any OpenAI-compatible URL (OpenRouter, DeepSeek, Ollama…).',
    pageType: 'config',
    configFields: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        options: ['openai', 'openrouter', 'gemini', 'custom'],
        help: 'openrouter/custom call any model through the OpenAI-compatible base URL',
      },
      {
        key: 'baseUrl',
        label: 'Base URL (OpenAI-compatible)',
        type: 'text',
        help: 'Ignored for openai/openrouter. Custom example: http://localhost:11434/v1 (Ollama), https://api.deepseek.com/v1',
      },
      { key: 'apiKey', label: 'API key', type: 'password' },
      {
        key: 'model',
        label: 'Model',
        type: 'text',
        help: 'Provider model id: gpt-4o-mini, openai/gpt-4o-mini (OpenRouter), anthropic/claude-3.5-sonnet (OpenRouter), gemini-2.0-flash',
      },
      {
        key: 'transcriptionModel',
        label: 'Voice transcription model',
        type: 'text',
        help: 'Model for voice notes on the OpenAI-compatible /audio/transcriptions endpoint; empty = whisper-1',
      },
      { key: 'systemPrompt', label: 'System prompt', type: 'textarea' },
      { key: 'maxTokens', label: 'Max tokens', type: 'number' },
      { key: 'historyLimit', label: 'History turns', type: 'number' },
      {
        key: 'smartHandoff',
        label: 'Smart human handoff (AI classifier)',
        type: 'switch',
        help: 'Classifies requests for a human agent with the LLM; falls back to keywords when off or on failure',
      },
      {
        key: 'showSources',
        label: 'Append knowledge sources to replies',
        type: 'switch',
        help: 'Shows which knowledge base documents grounded the answer',
      },
      {
        key: 'embeddingModel',
        label: 'Embedding model (semantic RAG, optional)',
        type: 'text',
        help: 'OpenAI-compatible embeddings, e.g. text-embedding-3-small; empty = keyword-only retrieval',
      },
      {
        key: 'knowledgeTags',
        label: 'Knowledge tag filter (optional)',
        type: 'text',
        help: 'Comma-separated tags; only docs carrying one of these are retrieved',
      },
    ],
    docs: {
      overview: [
        'Answers private user messages around the clock with an enterprise tone.',
        'Speaks the OpenAI Chat Completions protocol, so every OpenAI-compatible service works: OpenRouter, DeepSeek, Groq, Ollama, vLLM, and more; Gemini uses its native API.',
        'Keeps a short per-user history for contextual answers.',
      ],
      setup: [
        'Pick a provider: openai, openrouter, gemini, or custom (your own OpenAI-compatible base URL).',
        'Paste the API key, set the model id in the provider format (OpenRouter uses vendor/model such as openai/gpt-4o-mini), and tune the system prompt.',
        'Use the built-in test button before enabling.',
      ],
      troubleshooting: [
        'The assistant defers to the support desk and autoresponder keyword rules.',
        'Provider errors surface in the chat as a temporary-unavailable notice.',
        'Voice transcription needs an OpenAI-compatible /audio/transcriptions endpoint; OpenRouter does not expose one, so set transcriptionModel against a compatible provider (OpenAI, Groq, local Whisper).',
      ],
    },
  },
  {
    key: 'autoresponder',
    name: 'Commands & Auto-Responder',
    category: 'Automation & Monetization',
    description: 'Custom /commands and keyword triggers with media.',
    pageType: 'crud',
    configFields: [{ key: 'startMessage', label: 'Default /start message', type: 'textarea' }],
    crud: {
      endpoint: '/bots/{botId}/autoresponders',
      columns: [
        { key: 'command', label: 'Trigger' },
        { key: 'response_text', label: 'Response' },
        { key: 'is_active', label: 'Active', type: 'bool' },
      ],
      formFields: [
        { key: 'command', label: 'Command (/price) or keyword', type: 'text' },
        { key: 'responseText', label: 'Response text', type: 'textarea' },
        { key: 'mediaUrl', label: 'Photo URL', type: 'text' },
        { key: 'buttons', label: 'Buttons (JSON array)', type: 'json' },
      ],
      initialForm: { command: '', responseText: '', mediaUrl: '', buttons: '' },
    },
    docs: {
      overview: [
        'Custom commands like /pricing and /faq answered instantly with media.',
        'Non-slash triggers match message substrings as keyword auto-responders.',
      ],
      setup: [
        'Create rules; commands must start with /, keywords must not.',
        'Photo URLs and inline buttons are optional enhancements.',
      ],
      troubleshooting: [
        'When the Start Menu module owns /start, its menu takes precedence.',
        'Keyword rules also pause AI assistant replies to avoid double answers.',
      ],
    },
  },
  {
    key: 'paid-media',
    name: 'Paid Media Paywall',
    category: 'Automation & Monetization',
    description: 'Stars-locked photos and videos via sendPaidMedia.',
    pageType: 'monetization',
    configFields: [
      { key: 'starCount', label: 'Default price (Stars)', type: 'number' },
      { key: 'protectCaption', label: 'Protect caption content', type: 'switch' },
    ],
    docs: {
      overview: [
        'Sends media that users unlock by paying Telegram Stars.',
        "Funds settle to the bot owner's Fragment balance.",
      ],
      setup: [
        'Send paid media from the monetization tab to any chat id.',
        'Price each send in Stars; recipients see a native paywall.',
      ],
      troubleshooting: [
        'Requires a Bot API version supporting sendPaidMedia.',
        'Media must be publicly reachable URLs.',
      ],
    },
  },
  {
    key: 'vip-subs',
    name: 'VIP Subscriptions',
    category: 'Automation & Monetization',
    description: 'Star-priced channel invites with expiry enforcement.',
    pageType: 'monetization',
    configFields: [
      {
        key: 'channelChatId',
        label: 'VIP channel',
        type: 'chatSelect',
        connectionTypes: ['channel'],
        help: 'Private channel the bot administrates; manage the list in Chat Connections',
      },
      { key: 'subscriptionPeriodDays', label: 'Period (days)', type: 'number' },
      { key: 'starPrice', label: 'Price (Stars)', type: 'number' },
    ],
    docs: {
      overview: [
        'createChatSubscriptionInviteLink generates Star-billed invite links.',
        'Expired members are removed automatically by the sweep timer.',
      ],
      setup: [
        'Create a private channel and add the bot as an administrator.',
        'Set the channel id, period, and Star price, then grant subscriptions.',
      ],
      troubleshooting: [
        'The channel must allow the bot to manage invite links.',
        'Removal uses ban + unban, so the member can rejoin after renewing.',
      ],
    },
  },
  {
    key: 'webhooks',
    name: 'Webhooks Hub',
    category: 'Automation & Monetization',
    description: 'Signed outgoing events and inbound automation triggers.',
    pageType: 'webhooks',
    docs: {
      overview: [
        'Stream events (orders, form submissions, support activity) to Zapier, Make, or n8n.',
        'Every delivery is signed with HMAC-SHA256 in X-Studio-Signature.',
        'Inbound hooks render templated messages into a chat from external systems.',
      ],
      setup: [
        'Register an outgoing endpoint with a shared secret and event filter.',
        'Verify signatures on the receiving side before trusting payloads.',
        'For inbound, create a hook and POST JSON to its URL.',
      ],
      troubleshooting: [
        'Empty event lists subscribe an endpoint to every event.',
        'Failed deliveries are logged in the delivery log tab.',
      ],
    },
  },
];

/**
 * Documentation-only catalog entry for the Mini App Studio page. Not part of
 * the toggleable module list; it feeds the standard help dialog.
 * @type {ModuleEntry}
 */
export const MINI_APPS_DOCS_ENTRY: ModuleEntry = {
  key: 'mini-apps',
  name: 'Mini App Studio',
  category: 'Automation & Monetization',
  description: 'Create, host, and publish Telegram Mini Apps without external hosting.',
  pageType: 'config',
  docs: {
    overview: [
      'Build and host Telegram Mini Apps directly from the studio on the unified /tma/* route.',
      'Five enterprise templates: E-Commerce storefront, Loyalty hub, dynamic Forms, daily Spin wheel, and external Webview wrapper.',
      'The embedded phone preview renders the live app; publishing wires the chat menu button in one click.',
    ],
    setup: [
      'Create a BotFather bot and register it in the studio (the bot must be running).',
      'Create a Mini App, pick a template, and adjust its JSON configuration.',
      'Host HTTPS is required by Telegram: set the public base URL before publishing.',
      'Publish to set the chat bottom-left menu button via setChatMenuButton.',
    ],
    troubleshooting: [
      'Telegram requires an HTTPS public URL for Mini Apps; localhost only works inside Telegram Desktop with flags.',
      'Mini App API calls are validated with initData HMAC-SHA256 signatures tied to the owning bot token.',
      'The Webview template cannot frame sites that send X-Frame-Options or CSP frame-ancestors restrictions.',
    ],
  },
};

/**
 * Finds a module entry by key.
 * @param {string} key - Module registry key.
 * @returns {ModuleEntry | undefined} Entry when present.
 */
export function findModule(key: string): ModuleEntry | undefined {
  return MODULES.find((module) => module.key === key);
}

/**
 * Groups modules by category preserving catalog order.
 * @returns {Array<[string, ModuleEntry[]]>} Category to entries tuples.
 */
export function modulesByCategory(): Array<[string, ModuleEntry[]]> {
  const map = new Map<string, ModuleEntry[]>();
  for (const module of MODULES) {
    const bucket = map.get(module.category) ?? [];
    bucket.push(module);
    map.set(module.category, bucket);
  }
  return [...map.entries()];
}
