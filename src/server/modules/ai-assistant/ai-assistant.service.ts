import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Chat message exchanged with an AI provider.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Effective AI assistant module configuration.
 */
export interface AiConfig {
  provider: 'openai' | 'gemini';
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  historyLimit: number;
}

/**
 * AI Knowledge Assistant service with RAG knowledge retrieval,
 * persistent chat history, and multimodal Whisper audio transcription.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Produces an assistant reply for the given conversation, enriching the prompt
   * with RAG knowledge base context and user context (points, orders) when applicable.
   * @param {number} botId - Owning bot identifier.
   * @param {number} telegramId - User telegram identifier.
   * @param {AiConfig} config - Effective module configuration.
   * @param {ChatMessage[]} history - Conversation history.
   * @returns {Promise<string>} Assistant reply text.
   */
  async completeWithContext(
    botId: number,
    telegramId: number,
    config: AiConfig,
    history: ChatMessage[],
  ): Promise<string> {
    if (!config.apiKey) {
      return 'The AI assistant is not configured with an API key yet.';
    }

    const latestUserMessage = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

    // 1. RAG Knowledge Retrieval
    const relevantDocs = this.retrieveKnowledgeDocs(botId, latestUserMessage);

    // 2. User Tool Context (Points & Recent Orders)
    const userContext = this.getUserActionContext(botId, telegramId, latestUserMessage);

    let systemPrompt = config.systemPrompt || 'You are a helpful customer support assistant for Telegram.';

    if (relevantDocs) {
      systemPrompt += `\n\n[OFFICIAL KNOWLEDGE BASE CONTEXT]\n${relevantDocs}\nAnswer user queries based strictly on the knowledge base above when relevant.`;
    }

    if (userContext) {
      systemPrompt += `\n\n[AUTHENTICATED USER CONTEXT]\n${userContext}`;
    }

    const effectiveConfig: AiConfig = {
      ...config,
      systemPrompt,
    };

    if (config.provider === 'gemini') {
      return this.callGemini(effectiveConfig, history);
    }
    return this.callOpenAi(effectiveConfig, history);
  }

  /**
   * Basic complete method for standalone requests.
   */
  async complete(config: AiConfig, history: ChatMessage[]): Promise<string> {
    if (!config.apiKey) {
      return 'The AI assistant is not configured with an API key yet.';
    }
    if (config.provider === 'gemini') {
      return this.callGemini(config, history);
    }
    return this.callOpenAi(config, history);
  }

  /**
   * Retrieves relevant knowledge documents matching terms in the query.
   */
  private retrieveKnowledgeDocs(botId: number, query: string): string {
    const docs = this.db.query<{ id: number; title: string; content: string }>(
      'SELECT id, title, content FROM ai_knowledge_docs WHERE bot_id = ? LIMIT 20',
      botId,
    );
    if (docs.length === 0) return '';

    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const matches = docs.filter((doc) => {
      const text = `${doc.title} ${doc.content}`.toLowerCase();
      return words.some((word) => text.includes(word));
    });

    const chosen = matches.length > 0 ? matches.slice(0, 4) : docs.slice(0, 2);
    return chosen.map((d) => `### ${d.title}\n${d.content}`).join('\n\n');
  }

  /**
   * Fetches user balance and orders if the query relates to account or orders.
   */
  private getUserActionContext(botId: number, telegramId: number, query: string): string {
    const lower = query.toLowerCase();
    const contextParts: string[] = [];

    if (lower.includes('point') || lower.includes('puan') || lower.includes('balance') || lower.includes('bakiye')) {
      const user = this.db.get<{ points: number }>(
        'SELECT points FROM bot_users WHERE bot_id = ? AND telegram_id = ?',
        botId,
        telegramId,
      );
      if (user) {
        contextParts.push(`User loyalty points balance: ${user.points} points.`);
      }
    }

    if (lower.includes('order') || lower.includes('siparis') || lower.includes('kargo') || lower.includes('status')) {
      const orders = this.db.query<{ id: number; total_amount: number; currency: string; status: string; created_at: string }>(
        'SELECT id, total_amount, currency, status, created_at FROM mini_app_orders WHERE bot_id = ? AND telegram_id = ? ORDER BY id DESC LIMIT 3',
        botId,
        telegramId,
      );
      if (orders.length > 0) {
        const orderSummary = orders
          .map((o) => `Order #${o.id}: ${o.total_amount} ${o.currency}, status: ${o.status} (${o.created_at})`)
          .join('; ');
        contextParts.push(`User recent orders: ${orderSummary}`);
      }
    }

    return contextParts.join('\n');
  }

  /**
   * Transcribes Telegram audio / voice message using OpenAI Whisper API.
   * @param {string} apiKey - OpenAI API key.
   * @param {Buffer} audioBuffer - Audio file bytes.
   * @param {string} filename - File name (e.g. voice.oga).
   * @returns {Promise<string>} Transcribed text.
   */
  async transcribeAudio(apiKey: string, audioBuffer: Buffer, filename: string): Promise<string> {
    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
      formData.append('file', blob, filename);
      formData.append('model', 'whisper-1');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Whisper API returned status ${response.status}`);
      }

      const result = (await response.json()) as { text?: string };
      return result.text ?? '';
    } catch (err) {
      this.logger.warn(`Whisper transcription failed: ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  }

  /**
   * Loads persisted conversation turns for a user from SQLite.
   */
  getHistory(botId: number, telegramId: number, limit = 10): ChatMessage[] {
    const rows = this.db.query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content FROM ai_chat_history
       WHERE bot_id = ? AND telegram_id = ?
       ORDER BY id DESC LIMIT ?`,
      botId,
      telegramId,
      limit,
    );
    return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  /**
   * Appends a message to persistent chat history.
   */
  saveMessage(botId: number, telegramId: number, role: 'user' | 'assistant', content: string): void {
    this.db.run(
      `INSERT INTO ai_chat_history (bot_id, telegram_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      botId,
      telegramId,
      role,
      content,
      new Date().toISOString(),
    );
  }

  /**
   * Knowledge Docs CRUD: lists all docs for a bot.
   */
  listDocs(botId: number): Array<{ id: number; title: string; content: string; tags: string | null; created_at: string }> {
    return this.db.query(
      'SELECT id, title, content, tags, created_at FROM ai_knowledge_docs WHERE bot_id = ? ORDER BY id DESC',
      botId,
    );
  }

  /**
   * Knowledge Docs CRUD: adds a new doc.
   */
  addDoc(botId: number, title: string, content: string, tags?: string): { id: number } {
    const result = this.db.run(
      'INSERT INTO ai_knowledge_docs (bot_id, title, content, tags, created_at) VALUES (?, ?, ?, ?, ?)',
      botId,
      title,
      content,
      tags ?? null,
      new Date().toISOString(),
    );
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Knowledge Docs CRUD: deletes a doc.
   */
  removeDoc(botId: number, docId: number): void {
    this.db.run('DELETE FROM ai_knowledge_docs WHERE bot_id = ? AND id = ?', botId, docId);
  }

  private async callOpenAi(config: AiConfig, history: ChatMessage[]): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        max_tokens: config.maxTokens || 600,
        messages: [{ role: 'system', content: config.systemPrompt }, ...history],
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return payload.choices?.[0]?.message?.content ?? 'No response generated.';
  }

  private async callGemini(config: AiConfig, history: ChatMessage[]): Promise<string> {
    const model = config.model || 'gemini-2.0-flash';
    const contents = history.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: config.systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: config.maxTokens || 600 },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return payload.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response generated.';
  }
}
