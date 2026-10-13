import { Injectable, Logger } from '@nestjs/common';
import { AiModel } from '../../models/ai.model';
import { BotUserModel } from '../../models/bot-user.model';
import { MiniAppModel } from '../../models/mini-app.model';

/**
 * Chat message exchanged with an AI provider.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Effective AI assistant module configuration.
 *
 * Every provider except `gemini` speaks the OpenAI Chat Completions protocol
 * against `baseUrl`, so any OpenAI-compatible service (OpenRouter, DeepSeek,
 * Groq, Ollama, vLLM, ...) works with the same code path.
 */
export interface AiConfig {
  provider: 'openai' | 'openrouter' | 'gemini' | 'custom';
  apiKey: string;
  /** OpenAI-compatible API root, e.g. https://openrouter.ai/api/v1 */
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  historyLimit: number;
  /** LLM-based human handoff classifier; keyword fallback when false. */
  smartHandoff?: boolean;
  /** Transcription model for voice notes; defaults to whisper-1. */
  transcriptionModel?: string;
  /** Embedding model for semantic RAG; defaults to text-embedding-3-small. */
  embeddingModel?: string;
  /** Comma-separated tag allow-list for knowledge retrieval (empty = all docs). */
  knowledgeTags?: string;
  /** Append matched source titles to user-facing AI replies. */
  showSources?: boolean;
}

/** A knowledge chunk matched during retrieval, with its similarity score. */
export interface RetrievedChunk {
  docId: number;
  docTitle: string;
  content: string;
  score: number;
}

/** Assistant reply enriched with the knowledge chunks that grounded it. */
export interface CompletionResult {
  reply: string;
  sources: RetrievedChunk[];
  /** Provider usage from this call, for persisting metrics. */
  usage: ChatUsage | null;
  latencyMs: number;
  /** True when the provider call failed (reply contains the fallback text). */
  isError?: boolean;
}

/** Raw usage payload from an OpenAI-compatible chat completion. */
interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** Result of a provider call including usage and latency for metrics. */
interface ProviderCall {
  reply: string;
  usage: ChatUsage | null;
  latencyMs: number;
}

/**
 * AI Knowledge Assistant service with RAG knowledge retrieval,
 * persistent chat history, and multimodal Whisper audio transcription.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly aiModel: AiModel,
    private readonly botUserModel: BotUserModel,
    private readonly miniAppModel: MiniAppModel,
  ) {}

  /**
   * Produces an assistant reply for the given conversation, enriching the prompt
   * with RAG knowledge base context and user context (points, orders) when applicable.
   * Returns only the reply text (sources available via `completeWithSources`).
   */
  async completeWithContext(
    botId: number,
    telegramId: number,
    config: AiConfig,
    history: ChatMessage[],
  ): Promise<string> {
    const result = await this.completeWithSources(botId, telegramId, config, history);
    return result.reply;
  }

  /**
   * Like `completeWithContext` but also returns the knowledge chunks that
   * grounded the answer (used by the RAG tester for citations).
   */
  async completeWithSources(
    botId: number,
    telegramId: number,
    config: AiConfig,
    history: ChatMessage[],
  ): Promise<CompletionResult> {
    if (!this.isConfigured(config)) {
      return {
        reply: 'The AI assistant is not configured with an API key yet.',
        sources: [],
        usage: null,
        latencyMs: 0,
        isError: false,
      };
    }

    const started = Date.now();
    const latestUserMessage = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

    // 1. RAG Knowledge Retrieval (semantic with keyword fallback)
    const { context: relevantDocs, sources } = await this.retrieveKnowledgeDocs(
      botId,
      config,
      latestUserMessage,
    );

    // 2. User Tool Context (Points & Recent Orders)
    const userContext = await this.getUserActionContext(botId, telegramId, latestUserMessage);

    let systemPrompt =
      config.systemPrompt || 'You are a helpful customer support assistant for Telegram.';

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

    try {
      const call =
        config.provider === 'gemini'
          ? await this.callGemini(effectiveConfig, history)
          : await this.callOpenAiCompatible(effectiveConfig, history);
      let reply = call.reply;
      if (config.showSources && sources.length > 0) {
        const titles = [...new Set(sources.map((source) => source.docTitle))]
          .slice(0, 3)
          .join(', ');
        reply += `\n\n📄 ${titles}`;
      }
      return {
        reply,
        sources,
        usage: call.usage,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        reply: error instanceof Error ? error.message : String(error),
        sources,
        usage: null,
        latencyMs: Date.now() - started,
        isError: true,
      };
    }
  }

  /**
   * Basic complete method for standalone requests.
   */
  async complete(config: AiConfig, history: ChatMessage[]): Promise<string> {
    if (!this.isConfigured(config)) {
      return 'The AI assistant is not configured with an API key yet.';
    }
    const call =
      config.provider === 'gemini'
        ? await this.callGemini(config, history)
        : await this.callOpenAiCompatible(config, history);
    return call.reply;
  }

  /**
   * True when the provider can be called: hosted providers need an API key,
   * while a custom OpenAI-compatible base URL (e.g. local Ollama) does not.
   */
  isConfigured(config: AiConfig): boolean {
    if (config.apiKey) return true;
    return config.provider === 'custom' && Boolean(config.baseUrl?.trim());
  }

  /**
   * Resolves the OpenAI-compatible API root for the provider.
   */
  private effectiveOpenAiBaseUrl(config: Pick<AiConfig, 'provider' | 'baseUrl'>): string {
    if (config.provider === 'openrouter') return 'https://openrouter.ai/api/v1';
    if (config.provider === 'openai') return 'https://api.openai.com/v1';
    return config.baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
  }

  /**
   * Splits document content into overlapping chunks for retrieval.
   * @param {string} text - Full document content.
   * @param {number} [size] - Chunk size in characters.
   * @param {number} [overlap] - Overlap between consecutive chunks.
   * @returns {string[]} Chunk texts.
   */
  private chunkContent(text: string, size = 800, overlap = 120): string[] {
    const clean = text.replace(/\s+\n/g, '\n').trim();
    if (clean.length <= size) return clean ? [clean] : [];
    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < clean.length) {
      let end = Math.min(cursor + size, clean.length);
      if (end < clean.length) {
        // Prefer breaking on a paragraph or sentence boundary.
        const breakPoint = clean.lastIndexOf('\n', end);
        if (breakPoint > cursor + size * 0.5) end = breakPoint;
      }
      chunks.push(clean.slice(cursor, end).trim());
      cursor = end - overlap;
      if (cursor < 0) cursor = 0;
      if (end >= clean.length) break;
    }
    return chunks.filter(Boolean);
  }

  /**
   * Embeds texts through the OpenAI-compatible /embeddings endpoint. Returns
   * null when embeddings are unavailable (missing key / provider without a
   * compatible endpoint) so callers can fall back to keyword retrieval.
   */
  private async embedTexts(config: AiConfig, texts: string[]): Promise<number[][] | null> {
    if (!this.isConfigured(config) || texts.length === 0) return null;
    // Gemini native API has no OpenAI-compatible embeddings surface here;
    // semantic retrieval requires an OpenAI-compatible baseUrl or OpenAI key.
    const baseUrl = this.effectiveOpenAiBaseUrl(config);
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.embeddingModel?.trim() || 'text-embedding-3-small',
          input: texts,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vectors = (payload.data ?? [])
        .map((item) => item.embedding)
        .filter((v): v is number[] => Array.isArray(v));
      return vectors.length === texts.length ? vectors : null;
    } catch {
      return null;
    }
  }

  /**
   * Parses a stored embedding vector, tolerating corrupt rows.
   * @param {string} raw - JSON float array.
   * @returns {number[]} Parsed vector, empty on failure.
   */
  private parseVector(raw: string): number[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')
        ? (parsed as number[])
        : [];
    } catch {
      return [];
    }
  }

  /**
   * Cosine similarity between two equal-length vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Indexes (or re-indexes) every knowledge doc of the bot into embedded
   * chunks. Fire-and-forget safe: failures are logged and keyword retrieval
   * keeps working.
   * @returns {Promise<number>} Number of chunks stored.
   */
  async indexKnowledgeBase(botId: number, config: AiConfig): Promise<number> {
    const docs = await this.aiModel.listDocs(botId);
    if (docs.length === 0) return 0;
    const tagFilter = this.parseTagFilter(config);
    const eligible = docs.filter((doc) => this.docMatchesTags(doc, tagFilter));
    let stored = 0;
    for (const doc of eligible) {
      const chunks = this.chunkContent(doc.content);
      if (chunks.length === 0) continue;
      const vectors = await this.embedTexts(config, chunks);
      await this.aiModel.replaceChunks(
        botId,
        doc.id,
        chunks.map((content, idx) => ({
          idx,
          content,
          vectorJson: vectors ? JSON.stringify(vectors[idx]) : null,
        })),
      );
      stored += chunks.length;
    }
    return stored;
  }

  /**
   * Parses the comma-separated knowledgeTags config into a normalized list.
   */
  private parseTagFilter(config: AiConfig): string[] {
    return (config.knowledgeTags ?? '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * True when a doc carries at least one of the configured filter tags
   * (an empty filter accepts every doc).
   */
  private docMatchesTags(doc: { tags: string | null }, tagFilter: string[]): boolean {
    if (tagFilter.length === 0) return true;
    const docTags = (doc.tags ?? '')
      .toLowerCase()
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    return docTags.some((tag) => tagFilter.includes(tag));
  }

  /**
   * Retrieves relevant knowledge for a query: semantic embedding search over
   * indexed chunks when vectors are available, keyword scoring as fallback.
   * When nothing matches, NOTHING is injected (no hallucinated context).
   * @returns {{context: string, sources: RetrievedChunk[]}} Context block and citations.
   */
  private async retrieveKnowledgeDocs(
    botId: number,
    config: AiConfig,
    query: string,
  ): Promise<{ context: string; sources: RetrievedChunk[] }> {
    const docs = await this.aiModel.listDocs(botId);
    if (docs.length === 0) return { context: '', sources: [] };
    const titleByDoc = new Map(docs.map((doc) => [doc.id, doc]));
    const tagFilter = this.parseTagFilter(config);
    const eligibleDocs = docs.filter((doc) => this.docMatchesTags(doc, tagFilter));
    const eligibleIds = new Set(eligibleDocs.map((doc) => doc.id));
    if (eligibleIds.size === 0) return { context: '', sources: [] };

    // Lazy first-time indexing: docs exist but the semantic index is empty.
    let chunks = await this.aiModel.listChunks(botId);
    const relevantChunks = chunks.filter((chunk) => eligibleIds.has(chunk.docId));
    if (relevantChunks.length === 0) {
      await this.indexKnowledgeBase(botId, config).catch(() => undefined);
      chunks = await this.aiModel.listChunks(botId);
    }
    chunks = chunks.filter((chunk) => eligibleIds.has(chunk.docId));

    const words = query
      .toLowerCase()
      .split(/[\s,.;:!?]+/)
      .filter((w) => w.length > 2);

    // 1. Semantic retrieval when chunk vectors exist and the query embeds.
    if (chunks.length > 0 && chunks.some((chunk) => chunk.vectorJson) && words.length > 0) {
      const [queryVector] = (await this.embedTexts(config, [query])) ?? [];
      if (queryVector) {
        const scored = chunks
          .filter((chunk) => chunk.vectorJson)
          .map((chunk) => {
            const vector = this.parseVector(chunk.vectorJson!);
            return { chunk, score: this.cosineSimilarity(queryVector, vector) };
          })
          .filter((item) => item.score >= 0.22)
          .sort((a, b) => b.score - a.score)
          .slice(0, 4);
        if (scored.length > 0) {
          return {
            context: scored
              .map(
                (item) =>
                  `### ${titleByDoc.get(item.chunk.docId)?.title ?? 'Document'}\n${item.chunk.content}`,
              )
              .join('\n\n'),
            sources: scored.map((item) => ({
              docId: item.chunk.docId,
              docTitle: titleByDoc.get(item.chunk.docId)?.title ?? 'Document',
              content: item.chunk.content.slice(0, 400),
              score: Number(item.score.toFixed(3)),
            })),
          };
        }
        // Below-threshold semantic match: trust the gate, inject nothing.
        return { context: '', sources: [] };
      }
    }

    // 2. Keyword fallback over full docs.
    if (words.length === 0) return { context: '', sources: [] };

    const scoredDocs = eligibleDocs
      .map((doc) => {
        const titleLower = (doc.title || '').toLowerCase();
        const tagsLower = (doc.tags || '').toLowerCase();
        const contentLower = (doc.content || '').toLowerCase();
        let score = 0;

        for (const word of words) {
          if (titleLower.includes(word)) score += 5;
          if (tagsLower.includes(word)) score += 4;
          if (contentLower.includes(word)) score += 1;
        }
        return { doc, score };
      })
      .filter((item) => item.score > 0);

    // If no matching terms found, return empty context (avoid hallucinating with unrelated docs)
    if (scoredDocs.length === 0) return { context: '', sources: [] };

    scoredDocs.sort((a, b) => b.score - a.score);
    const chosen = scoredDocs.slice(0, 3).map((item) => item.doc);

    return {
      context: chosen
        .map((d) => {
          const snippet = d.content.length > 1200 ? `${d.content.slice(0, 1200)}...` : d.content;
          return `### ${d.title}${d.tags ? ` [Tags: ${d.tags}]` : ''}\n${snippet}`;
        })
        .join('\n\n'),
      sources: chosen.map((doc) => ({
        docId: doc.id,
        docTitle: doc.title,
        content: doc.content.slice(0, 400),
        score: 0,
      })),
    };
  }

  /**
   * Fetches user balance and orders if the query relates to account or orders.
   */
  private async getUserActionContext(
    botId: number,
    telegramId: number,
    query: string,
  ): Promise<string> {
    const lower = query.toLowerCase();
    const contextParts: string[] = [];

    if (
      lower.includes('point') ||
      lower.includes('puan') ||
      lower.includes('balance') ||
      lower.includes('bakiye')
    ) {
      const user = await this.botUserModel.findByTelegramId(botId, telegramId);
      if (user) {
        contextParts.push(`User loyalty points balance: ${user.points} points.`);
      }
    }

    if (
      lower.includes('order') ||
      lower.includes('siparis') ||
      lower.includes('kargo') ||
      lower.includes('status')
    ) {
      const orders = await this.miniAppModel.listUserOrders(botId, telegramId, 3);
      if (orders.length > 0) {
        const orderSummary = orders
          .map(
            (o) =>
              `Order #${o.id}: ${o.total_amount} ${o.currency}, status: ${o.status} (${o.created_at})`,
          )
          .join('; ');
        contextParts.push(`User recent orders: ${orderSummary}`);
      }
    }

    return contextParts.join('\n');
  }

  /**
   * Transcribes Telegram audio / voice messages through the provider's
   * OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq, local
   * Whisper servers, ...). Returns an empty string when the call fails.
   */
  async transcribeAudio(
    config: Pick<AiConfig, 'provider' | 'apiKey' | 'baseUrl' | 'transcriptionModel'>,
    audioBuffer: Buffer,
    filename: string,
  ): Promise<string> {
    const baseUrl = this.effectiveOpenAiBaseUrl(config);
    const model = config.transcriptionModel?.trim() || 'whisper-1';
    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
      formData.append('file', blob, filename);
      formData.append('model', model);

      const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Transcription API at ${baseUrl} returned status ${response.status}`);
      }

      const result = (await response.json()) as { text?: string };
      return result.text ?? '';
    } catch (err) {
      this.logger.warn(
        `Transcription via ${baseUrl} (${model}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }

  /**
   * Loads persisted conversation turns for a user from Prisma.
   */
  async getHistory(botId: number, telegramId: number, limit = 10): Promise<ChatMessage[]> {
    return this.aiModel.getHistory(botId, telegramId, limit);
  }

  /**
   * Appends a message to persistent chat history and returns its row id.
   */
  async saveMessage(
    botId: number,
    telegramId: number,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<number> {
    return this.aiModel.saveMessage(botId, telegramId, role, content);
  }

  /**
   * Knowledge Docs CRUD: lists all docs for a bot.
   */
  async listDocs(botId: number) {
    return this.aiModel.listDocs(botId);
  }

  /**
   * Knowledge Docs CRUD: adds a new doc and re-indexes it in the background.
   */
  async addDoc(
    botId: number,
    title: string,
    content: string,
    tags?: string,
    config?: AiConfig,
  ): Promise<{ id: number }> {
    const created = await this.aiModel.addDoc(botId, title, content, tags);
    if (config) {
      void this.indexKnowledgeBase(botId, config).catch(() => undefined);
    }
    return created;
  }

  /**
   * Knowledge Docs CRUD: updates an existing doc and re-indexes it.
   */
  async updateDoc(
    botId: number,
    docId: number,
    title: string,
    content: string,
    tags?: string,
    config?: AiConfig,
  ): Promise<void> {
    await this.aiModel.updateDoc(botId, docId, title, content, tags);
    if (config) {
      void this.indexKnowledgeBase(botId, config).catch(() => undefined);
    }
  }

  /**
   * Knowledge Docs CRUD: deletes a doc.
   */
  async removeDoc(botId: number, docId: number): Promise<void> {
    await this.aiModel.removeDoc(botId, docId);
  }

  private async callOpenAiCompatible(
    config: AiConfig,
    history: ChatMessage[],
  ): Promise<ProviderCall> {
    const baseUrl = this.effectiveOpenAiBaseUrl(config);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
    // OpenRouter uses these optional headers for app attribution and rankings.
    if (config.provider === 'openrouter') {
      headers['X-Title'] = 'TG Bot Studio';
    }
    const started = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || this.defaultChatModel(config),
        max_tokens: config.maxTokens || 600,
        messages: [{ role: 'system', content: config.systemPrompt }, ...history],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`AI request to ${baseUrl} failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: ChatUsage;
    };
    return {
      reply: payload.choices?.[0]?.message?.content ?? 'No response generated.',
      usage: payload.usage ?? null,
      latencyMs: Date.now() - started,
    };
  }

  /**
   * Fallback chat model per provider; OpenRouter namespaces models by vendor.
   */
  private defaultChatModel(config: AiConfig): string {
    return config.provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';
  }

  private async callGemini(config: AiConfig, history: ChatMessage[]): Promise<ProviderCall> {
    const model = config.model || 'gemini-2.0-flash';
    const contents = history.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    const started = Date.now();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: config.systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: config.maxTokens || 600 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    return {
      reply: payload.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response generated.',
      usage: payload.usageMetadata
        ? {
            prompt_tokens: payload.usageMetadata.promptTokenCount,
            completion_tokens: payload.usageMetadata.candidatesTokenCount,
          }
        : null,
      latencyMs: Date.now() - started,
    };
  }

  /**
   * Aggregate AI usage metrics for the dashboard (trailing window).
   */
  async getUsageSummary(botId: number, days: number) {
    return this.aiModel.usageSummary(botId, days);
  }
}
