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
  id: string;
  bot_id: string;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
}
