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
      "Register each group, supergroup, and channel the bot operates in once — every target-chat field in the studio then offers them as a dropdown.",
      "Chats the bot is added to are discovered automatically; Sync imports them with their titles and types.",
      "Connections accept numeric ids (-100…) or public @usernames, and can be deactivated without deletion.",
      "Every chat-targeting module (scheduler, broadcast, giveaways, VIP subscriptions, paid media, webhooks) picks its targets from this list — keeping it current keeps every picker accurate.",
    ],
    setup: [
      "Add the bot to the target group or channel as an administrator (posting rights are enough for channels).",
      "Press Sync to import chats the bot already discovered, or add entries manually with their chat id or @username.",
      "Reference the same list from the Scheduler, Support Desk, Giveaways, VIP Subscriptions, Paid Media, and Webhooks modules.",
      "Forum-enabled supergroups additionally unlock the Support Desk and Topics modules.",
    ],
    troubleshooting: [
      "A numeric chat id is required for private chats; @usernames only work for public channels and groups.",
      "Sync only knows chats where the bot received at least one update (my_chat_member events).",
      "Removing a connection never kicks the bot; it only removes the studio-side shortcut.",
      "Discovery needs the bot to receive at least one update from a chat; channels need posting rights, groups only membership.",
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
      "The consolidated start menu: every destination your bot offers on /start lives here — chat folder share links (t.me/addlist/...), channels, groups, and external web links.",
      "Flat style renders one button list; categorized style groups destinations by type with section headers in the message text.",
      "Button layout is controlled per row (1-4 columns) and users can re-open the menu anytime with /menu.",
      "Click counters quantify engagement per menu item when tracking is enabled.",
      "The Start Menu owns /start whenever enabled — the Autoresponder default /start message steps aside while drip auto-subscribe still enrolls silently.",
    ],
    setup: [
      "In Telegram, create a chat folder and use its share link (t.me/addlist/...) as a menu item of type folder.",
      "Add channels, groups, and web destinations as items of their matching type; order controls button position.",
      "Set a start message with placeholders ({first_name}, {mention}) for a personalized header.",
      "Optionally set a public base URL to route buttons through the built-in click tracker.",
      "Send /start (or /menu) to the bot to verify the menu renders.",
      "Combine with Drip Sequences (auto-subscribe on /start) so new users see the menu and enter a nurture flow at the same time.",
    ],
    troubleshooting: [
      "Click tracking requires the studio to be reachable on a public HTTPS URL.",
      "Telegram caches inline keyboards briefly; edits apply to newly sent menus.",
      "When both this module and Custom Commands define a /start reply, the Start Menu takes priority.",
      "If the menu does not render for a user, check that no autoresponder command rule also claims /start with a different payload.",
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
      "Queue posts to channels with precise dispatch times, rich media, and inline buttons.",
      "A branded watermark line is appended to captions for consistent channel identity.",
      "Targets come from Chat Connections; the timezone offset feeds the {date} and {time} placeholders.",
    ],
    setup: [
      "Add the bot as an administrator in the target channel with permission to post.",
      "Copy the channel id (@username or numeric) into the post form.",
      "Schedule posts; the dispatcher checks every 30 seconds.",
      "Use Broadcast for immediate announcements and the Scheduler for planned slots — the two never conflict.",
    ],
    troubleshooting: [
      "Posts fail with 400 when the bot lacks admin rights in the target chat.",
      "Times are stored and compared in UTC ISO format.",
      "Watermarks only apply to scheduled captions, not to posts sent through Broadcast.",
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
      "Every user message opens a dedicated forum topic in your admin supergroup.",
      "Admins reply inside the topic; the bot relays the answer to the user.",
      "Quick commands: /ban, /unban, /info while replying in a topic.",
      "When enabled, Support owns private chats: the AI Assistant stands down while autoresponder keyword rules keep answering.",
    ],
    setup: [
      "Create a supergroup, enable Topics in its settings, and add the bot as an admin.",
      "Copy the supergroup id into the configuration and save.",
      "Users message the bot directly; topics appear automatically.",
      "AI escalations land here automatically — keep the module enabled (even without AI) to receive human-handoff tickets.",
    ],
    troubleshooting: [
      "Topic creation requires the bot to be an administrator with can_manage_topics.",
      "The auto-reply is throttled per user to avoid spamming receipts.",
      "Topics only appear in the configured forum supergroup; regular groups cannot host topics.",
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
      "Handles messages arriving through a manager personal Telegram Business connection.",
      "Useful for after-hours acknowledgements and triage outside working time.",
      "Fully isolated from normal bot chats: replies only touch the Business account conversations.",
    ],
    setup: [
      "In Telegram Business settings, connect the bot to the manager account.",
      "Copy the emitted business_connection_id into the configuration.",
      "Write a concise, professional auto-reply and enable the module.",
      "Telegram Business must be active on the connected account; the bot token itself needs no extra rights.",
    ],
    troubleshooting: [
      "Business message APIs evolve; replies are sent through the raw Bot API surface.",
      "If replies fail, verify the connection is still active in Telegram settings.",
      "Only text auto-replies are sent today; media and buttons in business replies are not supported.",
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
      "Classic day-1/day-3/day-7 onboarding and promotional journeys.",
      "Each step delays a configurable number of minutes after the previous one.",
      "Subscribers can be added manually or automatically on /start.",
      "Steps reuse the broadcast placeholders; enrollment works no matter which module answers /start.",
    ],
    setup: [
      "Create a campaign with at least one step (delayMinutes + text).",
      "Enable auto-subscribe on start or add subscribers from the campaign view.",
      "The scheduler advances steps every 30 seconds.",
      "Time the first step right after the Start Menu welcome so the first hour feels coherent.",
    ],
    troubleshooting: [
      "Users who blocked the bot are unsubscribed automatically on delivery failure.",
      "delayMinutes counts from the previous step, not from subscription.",
      "Campaigns are bot-scoped: cloning a bot copies campaign shells, not drip subscribers.",
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
      "Send announcements to everyone, a language segment, or recently active users.",
      "Rich media and inline buttons are supported with per-recipient placeholders.",
      "Success and failure counters update live while the queue drains.",
      "Audience filters read the subscriber profiles the engine records — language and recent activity come straight from CRM data.",
    ],
    setup: [
      "Grow the audience first: every user who messages the bot is recorded.",
      "Compose the broadcast, choose a target filter, and queue it.",
      "Monitor progress in the history table.",
      "Tag users in the CRM first if you plan to hand-pick segments manually via CSV export.",
    ],
    troubleshooting: [
      "Telegram limits broadcasts to ~30 messages per second; the engine paces below that.",
      "Users who blocked the bot count as failures and are skipped in spirit by future targeting.",
      "Broadcasts target private-chat subscribers; posting into groups is the Scheduler’s job.",
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
      "Every bot interaction upserts a subscriber profile automatically.",
      "Tag users into segments (VIP, beta, churn-risk) and keep internal notes.",
      "Export the full audience as CSV or JSON for external tooling.",
      "Point balances shown here are the same ledger used by Referrals, Quizzes, Reactions and the AI Assistant.",
    ],
    setup: [
      "No setup required; profiles accumulate as the bot runs.",
      "Use tags as broadcast filters and segmentation hooks.",
      "Tags are organizational today — broadcast targeting uses language and activity, not tags.",
    ],
    troubleshooting: [
      "Search matches username, name, and Telegram id.",
      "Points shown here feed the referral and gamification modules.",
      "Deleted profiles reappear automatically when the user messages the bot again.",
    ],
  },
  },
  {
    key: 'welcome',
    name: 'Group Welcome & Goodbye',
    category: 'Community & Moderation',
    description: 'Media greetings with buttons, goodbyes, clean-welcome, and service cleanup.',
    pageType: 'config',
    configFields: [
      { key: 'welcomeEnabled', label: "Welcome messages enabled", type: 'switch' },
      { key: 'template', label: "Welcome template", type: 'textarea' },
      { key: 'autoDeleteSeconds', label: "Auto-delete after (seconds, 0 = off)", type: 'number' },
      { key: 'cleanWelcome', label: "Replace previous greeting", type: 'switch' },
      { key: 'mediaUrl', label: "Welcome media URL", type: 'text', help: "Photo or video sent with the greeting caption" },
      { key: 'buttonsJson', label: "Buttons JSON", type: 'text', help: "[{\"text\": \"Join channel\", \"url\": \"https://t.me/...\"}] one per row" },
      { key: 'goodbyeEnabled', label: "Goodbye messages enabled", type: 'switch' },
      { key: 'goodbyeText', label: "Goodbye template", type: 'textarea' },
      { key: 'goodbyeMediaUrl', label: "Goodbye media URL", type: 'text' },
      { key: 'deleteServiceMessages', label: "Delete join service messages", type: 'switch' },
      { key: 'deleteLeaveMessages', label: "Delete leave service messages", type: 'switch' },
    ],
      docs: {
    overview: [
      "Greets new members with templates, media and inline buttons.",
      "Goodbye messages and clean-welcome keep exactly one greeting visible.",
      "Join/leave service messages are removed automatically.",
      "Runs on every join in groups; enable Captcha alongside — the captcha challenge is a separate message from the greeting.",
    ],
    setup: [
      "Add the bot as a group administrator with delete permissions.",
      "Compose templates with placeholders such as {mention} and {group_name}.",
      "Attach a media URL and buttons JSON for rich greetings.",
      "Keep the greeting short when Captcha is enabled so both messages stay readable in busy chats.",
    ],
    troubleshooting: [
      "Media greetings fall back to text when the URL cannot be sent.",
      "Auto-delete accepts 15 seconds up to one hour.",
      "Does not fire in channels; welcomes are group/supergroup only.",
    ],
  },
  },
  {
    key: 'captcha',
    name: 'Captcha Gatekeeper',
    category: 'Community & Moderation',
    description: 'Button, math or PM verification with kick timers and join requests.',
    pageType: 'config',
    configFields: [
      { key: 'mode', label: "Mode", type: 'select', options: ["button", "math", "pm-math"], help: "pm-math challenges in PM and falls back to a button" },
      { key: 'timeoutSeconds', label: "Timeout (seconds)", type: 'number' },
      { key: 'kickOnFail', label: "Kick on timeout", type: 'switch' },
      { key: 'successText', label: "Success message", type: 'text' },
      { key: 'buttonText', label: "Verify button label", type: 'text' },
      { key: 'joinRequestIntegration', label: "Handle join requests via PM captcha", type: 'switch' },
    ],
      docs: {
    overview: [
      "Anti-raid gate: new members must verify within the configured window.",
      "Button mode taps to verify; math replies with a sum; pm-math verifies in PM.",
      "Members stay muted until verified and solve the captcha once per group.",
      "Pairs with AntiRaid for full protection: AntiRaid throttles mass joins, the captcha then filters the survivors.",
    ],
    setup: [
      "Add the bot as a group administrator with ban permissions.",
      "Choose a mode and timeout, then enable the module.",
      "The bot needs restrict rights — mutes are lifted automatically on successful verification.",
    ],
    troubleshooting: [
      "pm-math falls back to a group button when the user never started the bot.",
      "Join-request integration needs chat_join_request updates (enabled).",
      "Approved users are not exempt: every new member solves the captcha exactly once per group.",
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
      { key: 'blocklistMode', label: "Blocklist mode", type: 'select', options: ["nothing", "warn", "kick", "ban", "tban", "mute", "tmute"], help: "Punishment for blocklist hits; per-entry {action} overrides this" },
      { key: 'blocklistDelete', label: "Delete matching messages", type: 'switch' },
      { key: 'floodMode', label: "Flood punishment", type: 'select', options: ["mute", "tmute", "kick", "ban", "tban"] },
    ],
      docs: {
    overview: [
      "Deletes messages matching blacklisted words (plain or /regex/ form), links, or floods.",
      "Repeat offenders escalate to a studio-level ban and chat kick.",
      "Banned users are listed here for review and manual unbans.",
      "The Locks module runs before this one when both are enabled, so lock hits never reach the blocklist.",
    ],
    setup: [
      "Grant the bot administrator rights with message deletion.",
      "Tune thresholds conservatively to avoid false positives.",
      "Warnings recorded here share the ledger of Group Moderation Commands — limits and warn modes apply to both.",
    ],
    troubleshooting: [
      "Regex entries use the /pattern/flags form, e.g. /\\bfree crypto\\b/i.",
      "Flood windows are per user per group and held in memory.",
      "Admins and approved users are always exempt from blocklist, link and flood checks.",
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
      "Users join via /giveaway and inline Participate buttons.",
      "Membership in required channels is verified through getChatMember.",
      "Winners are drawn with a seeded shuffle reproducible from the participant list.",
      "Required channels are picked from Chat Connections; membership checks need bot admin rights in those channels.",
    ],
    setup: [
      "Add the bot as an administrator in every required channel.",
      "Create the giveaway with channel ids and an end time.",
      "Announce /giveaway in your community to start collecting participants.",
      "Announce with Broadcast right after creating a giveaway for maximum participation.",
    ],
    troubleshooting: [
      "Verification fails when the bot cannot see the channel member list.",
      "Draws run every 60 seconds after ends_at passes.",
      "Point rewards are not part of giveaways — winners are drawn, not scored.",
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
      "Users share t.me/bot?start=ref_<id> deep links; attribution is automatic.",
      "Referrers earn points instantly; /top shows the standing leaderboard.",
      "Balances surface in Audience CRM and the AI Assistant quotes them when users ask about points.",
    ],
    setup: [
      "Enable the module and configure the reward per referral.",
      "Broadcast the personal link pattern to your community.",
      "Combine with Broadcast to teach the community the personal link pattern.",
    ],
    troubleshooting: [
      "Self-referrals and repeat attributions are ignored.",
      "The referrer must already be a known subscriber when the invitee arrives.",
      "Referral points cannot be reversed automatically; adjust points in the CRM if needed.",
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
      "sendPoll-powered quizzes with correct answers scored automatically.",
      "Points and per-quiz scoreboards persist for leaderboards (/scoreboard).",
      "Points land in the same ledger as referrals and reactions; /scoreboard reads it back per quiz.",
    ],
    setup: [
      "Create quizzes in the engagement tab (question, options, correct index, points).",
      "Users start a random quiz with the configured command.",
      "Share the trigger command in groups — quizzes are group-surface engagement.",
    ],
    troubleshooting: [
      "Polls must be non-anonymous for scoring; the module enforces this.",
      "Reactions analytics live in the same engagement tab.",
      "Quiz polls need no extra rights beyond the bot being able to send polls in the group.",
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
      "Counts emoji reactions on posts and awards points to the reacting member.",
      "The summary chart shows which emojis resonate with the audience.",
      "Works automatically: the engine subscribes to message_reaction updates — no extra BotFather setting.",
    ],
    setup: [
      "Add the bot as an administrator in the tracked channel.",
      "Reaction updates require the chat to permit bot reaction events.",
      "Best on channels with a linked discussion group so bot-visible reactions accumulate.",
    ],
    troubleshooting: [
      "Anonymous reactor identities cannot be attributed and are skipped.",
      "Emoji-only reactions are counted; paid and custom reactions are ignored.",
      "Reactions on posts older than the bot’s subscription are not retroactive.",
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
      "Every member message in your groups builds a per-day activity record: messages, replies to others, and media count separately.",
      "The weighted score ranks the most active members for any period (today, 7 days, 30 days, or all time).",
      "Rich leaderboard messages (header, per-member row template, footer, medals, parse mode, silent flag) can be sent instantly or on a recurring schedule to one or many connected chats.",
      "Schedules support once, hourly, daily, and weekly recurrences in UTC.",
      "Counts all member messages including admins; service messages and bots are ignored.",
    ],
    setup: [
      "Disable bot privacy mode via BotFather (or make the bot an admin) so it can see member messages in groups.",
      "Enable the module and tune the score weights in the configuration card.",
      "Pick one or more target chats, design the message format with placeholders, and check the live preview.",
      "Press Send now for a one-off posting, or Save as schedule to automate it.",
      "The composer’s chat picker reuses Chat Connections, exactly like Broadcast and the Scheduler.",
    ],
    troubleshooting: [
      "No members on the leaderboard usually means privacy mode is hiding group messages from the bot.",
      "Service messages (joins, pins, title changes) never count towards the score.",
      "Sending fails with 403 when the bot is not a member of the target chat or lacks posting rights.",
      "Scheduled times use UTC; daily/weekly runs fire at the configured HH:mm.",
      "Scheduled leaderboards use the bot’s configured timezone from Bot settings.",
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
      "Answers private user messages around the clock with an enterprise tone.",
      "Speaks the OpenAI Chat Completions protocol, so every OpenAI-compatible service works: OpenRouter, DeepSeek, Groq, Ollama, vLLM, and more; Gemini uses its native API.",
      "Keeps a short per-user history for contextual answers.",
      "Knows loyalty point balances and recent mini-app orders — it quotes them when users ask about points or deliveries.",
    ],
    setup: [
      "Pick a provider: openai, openrouter, gemini, or custom (your own OpenAI-compatible base URL).",
      "Paste the API key, set the model id in the provider format (OpenRouter uses vendor/model such as openai/gpt-4o-mini), and tune the system prompt.",
      "Use the built-in test button before enabling.",
      "Escalations from the frustration classifier create Support Desk tickets automatically, even with Support disabled.",
    ],
    troubleshooting: [
      "The assistant defers to the support desk and autoresponder keyword rules.",
      "Provider errors surface in the chat as a temporary-unavailable notice.",
      "Voice transcription needs an OpenAI-compatible /audio/transcriptions endpoint; OpenRouter does not expose one, so set transcriptionModel against a compatible provider (OpenAI, Groq, local Whisper).",
      "Knowledge retrieval and tool context run in private chats only; group messages are not answered.",
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
      "Custom commands like /pricing and /faq answered instantly with media.",
      "Non-slash triggers match message substrings as keyword auto-responders.",
      "Rules can run in groups too — scope each rule to private, group, or both, and pin it to one chat if needed.",
    ],
    setup: [
      "Create rules; commands must start with /, keywords must not.",
      "Photo URLs and inline buttons are optional enhancements.",
      "Keyword matches temporarily pause the AI Assistant for that message to prevent double answers.",
    ],
    troubleshooting: [
      "When the Start Menu module owns /start, its menu takes precedence.",
      "Keyword rules also pause AI assistant replies to avoid double answers.",
      "Hashtag notes (#faq) and prefix/exact modes work on every chat surface the rule is scoped to.",
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
      "Sends media that users unlock by paying Telegram Stars.",
      "Funds settle to the bot owner's Fragment balance.",
      "Dashboard-triggered only — pair with Broadcast to announce a paid drop to the right audience.",
    ],
    setup: [
      "Send paid media from the monetization tab to any chat id.",
      "Price each send in Stars; recipients see a native paywall.",
      "Recipients pay in Telegram Stars; no extra bot configuration is needed beyond a modern Bot API.",
    ],
    troubleshooting: [
      "Requires a Bot API version supporting sendPaidMedia.",
      "Media must be publicly reachable URLs.",
      "Stars revenue settles in the bot owner’s Fragment payout, not in the studio.",
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
      "createChatSubscriptionInviteLink generates Star-billed invite links.",
      "Expired members are removed automatically by the sweep timer.",
      "Username-only connections cannot host VIP subscriptions — a numeric channel id from Chat Connections is required.",
    ],
    setup: [
      "Create a private channel and add the bot as an administrator.",
      "Set the channel id, period, and Star price, then grant subscriptions.",
      "Grant subscriptions from the Monetization tab; the expiry sweeper removes lapsed members every minute.",
    ],
    troubleshooting: [
      "The channel must allow the bot to manage invite links.",
      "Removal uses ban + unban, so the member can rejoin after renewing.",
      "If removal fails, re-check that the bot still has ban rights in the VIP channel.",
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
      "Stream events (orders, form submissions, support activity) to Zapier, Make, or n8n.",
      "Every delivery is signed with HMAC-SHA256 in X-Studio-Signature.",
      "Inbound hooks render templated messages into a chat from external systems.",
      "order_created, order_paid and form_submitted fire from Mini App checkouts and forms — wire them to fulfillment tools.",
    ],
    setup: [
      "Register an outgoing endpoint with a shared secret and event filter.",
      "Verify signatures on the receiving side before trusting payloads.",
      "For inbound, create a hook and POST JSON to its URL.",
      "Use the delivery log tab to debug signatures; every payload is HMAC-signed.",
    ],
    troubleshooting: [
      "Empty event lists subscribe an endpoint to every event.",
      "Failed deliveries are logged in the delivery log tab.",
      "Inbound hooks bypass the JWT guard by design — keep hook ids unguessable.",
    ],
  },
  },
  {
    key: 'group-moderation',
    name: 'Group Moderation Commands',
    category: 'Community & Moderation',
    description: 'In-group admin commands: ban, mute, kick, warnings, purges, approvals, silent actions.',
    pageType: 'config',
    configFields: [
      { key: 'warnLimit', label: "Warning limit", type: 'number', help: "Warnings before the warn mode punishment fires (0 disables)" },
      { key: 'warnMode', label: "Warning mode", type: 'select', options: ["kick", "ban", "tban", "mute", "tmute"], help: "Punishment applied when the warn limit is reached" },
      { key: 'warnTimeSeconds', label: "Warn expiry (seconds, 0 = off)", type: 'number' },
      { key: 'silentActions', label: "Silent actions", type: 'switch', help: "s-commands and punishments without confirmation messages" },
      { key: 'adminError', label: "Reply to non-admins", type: 'switch', help: "Show \"admin only\" errors to unauthorized users" },
    ],
      docs: {
    overview: [
      "Full admin command set directly in the group chat.",
      "ban/mute/kick families with timed (tban/tmute), delete (d*) and silent (s*) variants.",
      "Persistent warnings with configurable limit, mode and expiry, plus purge commands.",
      "Approvals make trusted members immune to automated moderation.",
      "Warnings issued here share the ledger with the moderation module’s blocklist-warn mode; limits apply once across both.",
    ],
    setup: [
      "Enable the module, then use /ban, /mute, /warn, /purge and friends in the group.",
      "The bot must be a group administrator with restrict and delete rights.",
      "Tune defaults here; groups can override them with /setwarnlimit and /setwarnmode.",
      "Every action is emitted to the Admin Log Channel module when it is enabled — run both for a full audit trail.",
    ],
    troubleshooting: [
      "Purges only reach messages younger than 48 hours (Telegram limitation).",
      "Warnings persist in the database; /resetwarn clears a user entirely.",
      "Commands respect Telegram admin rights, not studio roles: an admin without restrict rights cannot ban.",
    ],
  },
  },
  {
    key: 'group-tools',
    name: 'Group Admin Tools',
    category: 'Community & Moderation',
    description: 'Pins, user reports, admin list, /id and /info lookups, echo, and command disabling.',
    pageType: 'config',
    configFields: [
      { key: 'reportsEnabled', label: "User reports enabled", type: 'switch', help: "/report and @admin notify group admins" },
      { key: 'antichannelPins', label: "Unpin linked channel posts", type: 'switch' },
      { key: 'cleanLinked', label: "Delete linked channel posts", type: 'switch', help: "Removes forwarded channel messages from the discussion group" },
    ],
      docs: {
    overview: [
      "Pin family: /pin, /pin loud, /permapin, /unpin, /unpinall, plus linked-channel controls.",
      "User reports: /report and @admin tag every admin invisibly.",
      "Lookups (/id, /info), admin listing, promote/demote, and /echo.",
      "Per-group command disabling with /disable and /enable.",
      "Command disabling applies to this module’s user-facing commands (/adminlist, /id, /info, /report).",
    ],
    setup: [
      "Enable the module; every command checks native Telegram admin permissions.",
      "Pin commands need the pin right; disabling commands needs change-info rights.",
      "Reports skip admins and bot senders; only human members can trigger them.",
    ],
    troubleshooting: [
      "Admins cannot be reported.",
      "Anonymous admins are trusted with full non-owner rights.",
      "/echo requires change-info rights because it posts as the bot.",
    ],
  },
  },
  {
    key: 'locks',
    name: 'Chat Locks',
    category: 'Community & Moderation',
    description: 'Fine-grained content locks: stickers, gifs, polls, forwards, links, scripts and more.',
    pageType: 'config',
    configFields: [
      { key: 'lockedTypes', label: "Locked types (one per line)", type: 'stringList', help: "Run /locktypes in the group for the full list" },
      { key: 'lockWarns', label: "Warn instead of just deleting", type: 'switch' },
      { key: 'allowlist', label: "Allowlist entries (one per line)", type: 'stringList', help: "Domains, stickerpack:<name>, forward:<id>, command:/cmd" },
    ],
      docs: {
    overview: [
      "45+ lock types: media kinds, stickers, polls, forwards, links, buttons.",
      "Script locks (rtl, cjk, cyrillic, zalgo) and anonymous-channel protection.",
      "Allowlist entries exempt specific domains, packs, forwards and commands.",
      "Custom punishments per lock via /lock <types> ### reason {action}.",
      "Lock violations can write warnings that share the Group Moderation warn limit and mode.",
    ],
    setup: [
      "Enable the module and lock content types with /lock gif poll url.",
      "Admins and approved users are always exempt.",
      "Lock evaluation runs before blocklists — enable Locks alongside Moderation for predictable stacking.",
    ],
    troubleshooting: [
      "Locks run before blocklists.",
      "Bot senders and service messages are never locked.",
      "Grouped media counts per item; the album lock catches media groups even when single types pass.",
    ],
  },
  },
  {
    key: 'antiraid',
    name: 'AntiRaid',
    category: 'Community & Moderation',
    description: 'Temporarily bans joiners during raid attacks, manually or automatically.',
    pageType: 'config',
    configFields: [
      { key: 'raidTimeSeconds', label: "Raid mode duration (seconds)", type: 'number' },
      { key: 'raidActionTimeSeconds', label: "Per-joiner ban (seconds)", type: 'number' },
      { key: 'autoRaidJoinThreshold', label: "Auto-enable after joins/minute (0 = off)", type: 'number' },
    ],
      docs: {
    overview: [
      "Raid mode bans every new joiner for a short period so raids drain out.",
      "Manual /antiraid on/off or a custom duration.",
      "/autoantiraid N enables automatically when N users join within a minute.",
      "Complements the Captcha module: AntiRaid drains join storms, the captcha then verifies the survivors.",
    ],
    setup: [
      "Enable the module and arm raid mode with /antiraid on when under attack.",
      "Tune durations so innocent late joiners are not banned for long.",
      "State is in-memory by design — re-arm after restarts or set auto-antiraid for self-healing.",
    ],
    troubleshooting: [
      "Raid state lives in memory; a restart disarms active raid mode.",
      "CAPTCHAs or join requests prevent spam-joining entirely.",
      "Other bots joining the group are never banned by AntiRaid.",
    ],
  },
  },
  {
    key: 'rules',
    name: 'Group Rules',
    category: 'Community & Moderation',
    description: 'Per-group rules with /rules delivery and the {rules} placeholder button.',
    pageType: 'config',
    configFields: [
      { key: 'rulesText', label: "Rules text", type: 'textarea' },
      { key: 'privateRules', label: "Deliver rules via PM button", type: 'switch' },
      { key: 'rulesButton', label: "Button label", type: 'text' },
    ],
      docs: {
    overview: [
      "/rules shows the group rules in chat or via a PM deep-link button.",
      "The {rules} placeholder embeds the same link into welcome messages.",
      "Manage with /setrules, /resetrules, /privaterules and /setrulesbutton.",
      "The {rules} placeholder works in welcome texts, notes and any templated module message.",
    ],
    setup: [
      "Enable the module and set the rules text (or use /setrules in the group).",
      "Users must start the bot in PM for private rule delivery.",
      "Private delivery needs users to have started the bot; otherwise the button opens an empty chat.",
    ],
    troubleshooting: [
      "Empty rules text makes /rules reply \"no rules set\".",
      "The deep link only works with a public bot username.",
      "Rules text supports the same HTML subset as every messaging module.",
    ],
  },
  },
  {
    key: 'admin-log',
    name: 'Admin Log Channel',
    category: 'Community & Moderation',
    description: 'Forwards admin actions and automated punishments to a Telegram log channel.',
    pageType: 'config',
    configFields: [
      { key: 'logChatId', label: "Log channel id", type: 'number', help: "Numeric channel id the bot posts logs to" },
      { key: 'categories', label: "Categories (one per line)", type: 'stringList', help: "settings, admin, user, automated, reports, other" },
    ],
      docs: {
    overview: [
      "Persistent log of bans, mutes, warns, settings changes and reports.",
      "Category filters: settings, admin, user, automated, reports, other.",
      "Link with /setlog <channelId> (group owner) or from the dashboard.",
      "Consumes events from Group Moderation, Locks, Moderation automation, Group Tools reports and settings changes.",
    ],
    setup: [
      "Create a channel, add the bot as administrator, and set its id here.",
      "Run /setlog <channelId> in the group to bind logging.",
      "One channel can receive logs from several groups; category filters are per group.",
    ],
    troubleshooting: [
      "Log channels must be channels; groups cannot receive logs.",
      "Removing the bot from the channel silently stops logging.",
      "Log messages respect Telegram rate limits; bursts are retried by the auto-retry layer.",
    ],
  },
  },
  {
    key: 'cleaning',
    name: 'Message Cleaning',
    category: 'Community & Moderation',
    description: 'Auto-deletes used commands, service messages, and bot action messages.',
    pageType: 'config',
    configFields: [
      { key: 'cleanCommand', label: "Clean used commands", type: 'select', options: ["off", "all", "admin", "user", "other"] },
      { key: 'cleanServiceTypes', label: "Service types (one per line)", type: 'stringList', help: "join, leave, pin, title, photo, videochat, other" },
      { key: 'cleanBotMessages', label: "Delete bot messages after 5 minutes", type: 'select', options: ["off", "on"] },
    ],
      docs: {
    overview: [
      "Used commands disappear after execution (by class: admin/user/other).",
      "Service messages (joins, pins, title and photo changes) auto-delete per type.",
      "The bot's own group messages can self-destruct after five minutes.",
      "Removes command texts after execution without touching module replies or announcements.",
    ],
    setup: [
      "Enable the module and pick which command classes to clean.",
      "Add service types like join and leave to keep the chat tidy.",
      "Safe with every module: cleaning never deletes user content, only command and service messages.",
    ],
    troubleshooting: [
      "Commands are removed with a short delay so they still execute.",
      "Bot-message cleanup needs no extra rights beyond sending.",
      "cleanCommand only matches this bot’s known command classes, not other bots’ commands.",
    ],
  },
  },
  {
    key: 'topics',
    name: 'Forum Topic Management',
    category: 'Community & Moderation',
    description: 'Create, rename, close and delete forum topics from chat commands.',
    pageType: 'config',
    configFields: [
      { key: 'actionTopicId', label: "Action topic id (0 = general)", type: 'number', help: "Bot messages route to this forum topic" },
    ],
      docs: {
    overview: [
      "Forum topic commands: /newtopic, /renametopic, /closetopic, /reopentopic, /deletetopic.",
      "/setactiontopic routes bot output to one topic.",
      "Every command runs inside the topic it affects.",
      "Independent of the Support Desk (which creates one topic per user); this module manages forum structure commands.",
    ],
    setup: [
      "Enable the module in a forum-enabled supergroup.",
      "Grant the bot the manage-topics administrator right.",
      "Only forum-enabled supergroups accept these commands.",
    ],
    troubleshooting: [
      "These commands only work in forum topics.",
      "Deleting a topic removes its messages permanently.",
      "Topic management checks the manage-topics right, the same right the Support Desk needs to create topics.",
    ],
  },
  },
  {
    key: 'federation',
    name: 'Ban Federations',
    category: 'Community & Moderation',
    description: 'Shared ban lists enforced across all joined chats of every studio bot.',
    pageType: 'config',
    configFields: [
      { key: 'quietFed', label: "Suppress fed-ban announcements", type: 'switch' },
      { key: 'fedNotif', label: "Notify the fed owner on actions", type: 'switch' },
      { key: 'fedReasonRequired', label: "Require a reason on /fban", type: 'switch' },
    ],
      docs: {
    overview: [
      "One ban list, every group: /fban removes users from all chats in the federation.",
      "Works across every bot in the studio, not just one.",
      "Fed admins, subscriptions (max 5), logs, and CSV/JSON imports.",
      "Federated bans apply before locks and blocklists — a fed-banned user is removed on first sight of any joined chat.",
    ],
    setup: [
      "Create a federation with /newfed <name> in the bot's PM.",
      "Join groups with /joinfed <fedId> (group owner runs it).",
      "Manage bans and imports from the manager below.",
      "Federations work across every bot in the studio: join two bots’ groups to the same fed for one shared ban list.",
    ],
    troubleshooting: [
      "Passive enforcement needs the chat_member update (already enabled).",
      "/leavefed keeps past bans in place until unbanned.",
      "Cross-bot enforcement needs each bot online; offline bots apply bans lazily when they next see the user.",
    ],
  },
  },
  {
    key: 'language',
    name: 'Bot Reply Language',
    category: 'Community & Moderation',
    description: 'Per-group bot reply language (/setlang) for moderation and system messages.',
    pageType: 'config',
    configFields: [
      { key: 'language', label: "Default language", type: 'select', options: ["en", "tr"] },
    ],
      docs: {
    overview: [
      "/setlang switches every bot reply between supported languages.",
      "All moderation, captcha, federation and tool messages localize.",
      "User-configured templates (welcome text, notes) stay as written.",
      "Affects every group module’s fixed messages; user-authored templates stay exactly as written.",
    ],
    setup: [
      "Enable the module and pick a default.",
      "Groups change it any time with /setlang.",
      "Group overrides beat the dashboard default; private chats always answer in English.",
    ],
    troubleshooting: [
      "Supported languages: English, Turkish, German, Russian, Spanish, Azerbaijani, Arabic, French, Italian, Portuguese, Ukrainian, Persian, Indonesian, Uzbek.",
      "Private chats default to English.",
      "A language change takes effect on the next message (short cache window).",
    ],
  },
  },
  {
    key: 'bot2bot',
    name: 'Bot-to-Bot Commands',
    category: 'Automation & Monetization',
    description: "Let other bots use this bot's group commands with an admin review gate.",
    pageType: 'config',
    configFields: [
      { key: 'mode', label: "Mode", type: 'select', options: ["off", "admin", "all"], help: "off ignores bots, admin trusts admin-bots only, all allows every bot" },
      { key: 'skipReview', label: "Skip the review queue", type: 'switch', help: "Trusted bots act immediately without Approve/Deny buttons" },
    ],
      docs: {
    overview: [
      "Automation and AI bots can drive moderation commands.",
      "Bot-issued admin actions queue behind inline Approve/Deny buttons.",
      "Skip reviews for trusted bots while keeping their real permissions.",
      "Gates the group command modules (Group Moderation, Group Tools); private-chat modules ignore bot senders regardless.",
    ],
    setup: [
      "Enable the module and choose a mode (off by default).",
      "Have the other bot send commands like /ban as a normal admin would.",
      "Start with mode admin and skipReview off; move to all only for trusted automation fleets.",
    ],
    troubleshooting: [
      "The acting bot still needs its own Telegram admin rights.",
      "Reviews live in memory and are dropped on restart.",
      "Bot senders still need their own Telegram admin rights for restrict-capable commands.",
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
      "Build and host Telegram Mini Apps directly from the studio on the unified /tma/* route.",
      "Five enterprise templates: E-Commerce storefront, Loyalty hub, dynamic Forms, daily Spin wheel, and external Webview wrapper.",
      "The embedded phone preview renders the live app; publishing wires the chat menu button in one click.",
      "Orders and form submissions feed Webhooks events and the AI Assistant’s order-aware answers.",
    ],
    setup: [
      "Create a BotFather bot and register it in the studio (the bot must be running).",
      "Create a Mini App, pick a template, and adjust its JSON configuration.",
      "Host HTTPS is required by Telegram: set the public base URL before publishing.",
      "Publish to set the chat bottom-left menu button via setChatMenuButton.",
      "Publishing requires a public HTTPS base URL and a running bot for setChatMenuButton.",
    ],
    troubleshooting: [
      "Telegram requires an HTTPS public URL for Mini Apps; localhost only works inside Telegram Desktop with flags.",
      "Mini App API calls are validated with initData HMAC-SHA256 signatures tied to the owning bot token.",
      "The Webview template cannot frame sites that send X-Frame-Options or CSP frame-ancestors restrictions.",
      "Spin and loyalty data are per bot — cloning copies app shells, not player data.",
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
