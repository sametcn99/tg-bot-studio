import React from 'react';
import { Box } from '@mui/material';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import AltRouteRoundedIcon from '@mui/icons-material/AltRouteRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import SellRoundedIcon from '@mui/icons-material/SellRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import { NODE_COLORS, type FlowNode } from './flowEditorModel';

/** Compact MUI icon props accepted by every node icon. */
type NodeIcon = React.ComponentType<{ fontSize?: 'small' | 'medium'; sx?: object }>;

/** Icon per node type, shared by the palette, canvas cards, and inspector. */
export const NODE_ICONS: Record<FlowNode['type'], NodeIcon> = {
  message: ChatBubbleOutlineRoundedIcon,
  input: EditNoteRoundedIcon,
  condition: AltRouteRoundedIcon,
  delay: ScheduleRoundedIcon,
  settag: SellRoundedIcon,
  end: FlagRoundedIcon,
};

/** Trigger entry card icon. */
export const TRIGGER_ICON: NodeIcon = BoltRoundedIcon;

/** Node types addable from the palette. */
export const PALETTE_TYPES: FlowNode['type'][] = [
  'message',
  'input',
  'condition',
  'delay',
  'settag',
  'end',
];

/**
 * Renders the colored icon tile used on cards and palette entries.
 * @param {object} props - Component props.
 * @param {FlowNode['type'] | 'trigger'} props.type - Node type or trigger.
 * @param {number} [props.size] - Tile size in pixels.
 * @returns {React.ReactElement} Rounded icon tile.
 */
export function NodeTypeIconTile({
  type,
  size = 26,
}: {
  type: FlowNode['type'] | 'trigger';
  size?: number;
}): React.ReactElement {
  const color = type === 'trigger' ? '#eab308' : NODE_COLORS[type];
  const Icon = type === 'trigger' ? TRIGGER_ICON : NODE_ICONS[type];
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 1.2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        backgroundColor: `${color}1f`,
        flexShrink: 0,
      }}
    >
      <Icon fontSize="small" />
    </Box>
  );
}
