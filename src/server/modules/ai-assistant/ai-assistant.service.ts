import { Injectable } from '@nestjs/common';

/**
 * Chat message exchanged with an AI provider.
 * @interface ChatMessage
 * @property {'system'|'user'|'assistant'} role - Conversation role.
 * @property {string} content - Message content.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Effective AI assistant module configuration.
 * @interface AiConfig
 * @property {'openai'|'gemini'} provider - Model provider.
 * @property {string} apiKey - Provider API key.
 * @property {string} model - Model identifier.
 * @property {string} systemPrompt - Enterprise tone system prompt.
 * @property {number} maxTokens - Response token cap.
 * @property {number} historyLimit - Retained turns per user.
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
 * AI Knowledge Assistant service. Calls the OpenAI Chat Completions API or
 * the Gemini generateContent API with the configured system prompt.
 */
@Injectable()
export class AiAssistantService {
  /**
   * Produces an assistant reply for the given conversation.
   * @param {AiConfig} config - Effective module configuration.
   * @param {ChatMessage[]} history - Conversation history (newest last).
   * @returns {Promise<string>} Assistant reply text.
   * @throws {Error} When the provider request fails or returns no content.
   * @example
   * const reply = await ai.complete(config, [{ role: 'user', content: 'Hi' }]);
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
   * Calls the OpenAI-compatible Chat Completions endpoint.
   * @param {AiConfig} config - Effective module configuration.
   * @param {ChatMessage[]} history - Conversation history.
   * @returns {Promise<string>} Assistant reply text.
   * @throws {Error} When the HTTP call fails or the payload is malformed.
   */
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

  /**
   * Calls the Gemini generateContent endpoint.
   * @param {AiConfig} config - Effective module configuration.
   * @param {ChatMessage[]} history - Conversation history.
   * @returns {Promise<string>} Assistant reply text.
   * @throws {Error} When the HTTP call fails or the payload is malformed.
   */
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
