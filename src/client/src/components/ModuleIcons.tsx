/**
 * Shared per-module icon registry consumed by the sidebar navigation and the
 * module help dialog header, so both surfaces render the same brand mark for
 * a module key.
 * @module components/ModuleIcons
 */
import React from 'react';
import TuneIcon from '@mui/icons-material/Tune';
import CableIcon from '@mui/icons-material/Cable';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import ForumIcon from '@mui/icons-material/Forum';
import CampaignIcon from '@mui/icons-material/Campaign';
import GroupsIcon from '@mui/icons-material/Groups';
import WavingHandIcon from '@mui/icons-material/WavingHand';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import GavelIcon from '@mui/icons-material/Gavel';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import ShareIcon from '@mui/icons-material/Share';
import QuizIcon from '@mui/icons-material/Quiz';
import SmartButtonIcon from '@mui/icons-material/SmartButton';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ReplyIcon from '@mui/icons-material/Reply';
import PaidIcon from '@mui/icons-material/Paid';
import StarIcon from '@mui/icons-material/Star';
import WebhookIcon from '@mui/icons-material/Webhook';
import WidgetsIcon from '@mui/icons-material/Widgets';

/** Module keys mapped to their icon components. */
const MODULE_ICON_COMPONENTS: Record<string, React.ElementType> = {
  connections: CableIcon,
  'start-menu': MenuBookIcon,
  scheduler: ScheduleIcon,
  support: SupportAgentIcon,
  business: BusinessCenterIcon,
  drip: ForumIcon,
  broadcast: CampaignIcon,
  crm: GroupsIcon,
  welcome: WavingHandIcon,
  captcha: VerifiedUserIcon,
  moderation: GavelIcon,
  giveaways: EmojiEventsIcon,
  referrals: ShareIcon,
  quizzes: QuizIcon,
  reactions: SmartButtonIcon,
  'ai-assistant': PsychologyIcon,
  autoresponder: ReplyIcon,
  'paid-media': PaidIcon,
  'vip-subs': StarIcon,
  webhooks: WebhookIcon,
  'mini-apps': WidgetsIcon,
};

/**
 * Resolves the icon component for a module key, falling back to a generic
 * tuning icon for unknown keys.
 * @param {string | undefined} key - Module registry key.
 * @returns {React.ElementType} Icon component to render.
 */
export function moduleIcon(key: string | undefined): React.ElementType {
  return (key !== undefined && MODULE_ICON_COMPONENTS[key]) || TuneIcon;
}
