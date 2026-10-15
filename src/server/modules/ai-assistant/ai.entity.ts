/**
 * Domain shape for chat history message.
 */
export interface AiChatHistoryMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Domain shape for AI knowledge doc.
 */
export interface AiKnowledgeDocEntity {
  id: number;
  bot_id: number;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
}
