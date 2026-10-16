/** One node of a flow graph. */
export interface FlowNode {
  id: string;
  type: 'message' | 'input' | 'condition' | 'delay' | 'settag' | 'end';
  /** Message text (HTML, placeholders allowed) for message/input prompts. */
  text?: string;
  /** Optional media URL or Telegram file_id attached to a message node. */
  mediaUrl?: string;
  /** Inline buttons: `{text, url?}` or `{text, next}` for flow navigation. */
  buttons?: Array<{ text: string; url?: string; next?: string }>;
  /** Variable captured by an input node, or read by a condition node. */
  variable?: string;
  /** Condition node: `{variable, op, value}` with `nextTrue` / `nextFalse`. */
  op?: 'equals' | 'contains' | 'exists';
  value?: string;
  nextTrue?: string;
  nextFalse?: string;
  /** Default continuation when no button/input branch applies. */
  next?: string;
  /** Delay node duration in minutes. */
  minutes?: number;
  /** Tag name written by a settag node. */
  tag?: string;
  /** Canvas position persisted by the visual editor; ignored by the runtime. */
  x?: number;
  /** Canvas position persisted by the visual editor; ignored by the runtime. */
  y?: number;
}

/** Parsed flow graph document. */
export interface FlowGraph {
  start: string;
  nodes: FlowNode[];
}
