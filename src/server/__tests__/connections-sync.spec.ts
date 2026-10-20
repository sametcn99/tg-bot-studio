import { describe, expect, it } from 'bun:test';
import { toChatConnectionRow } from '../modules/connections/connections.service';

describe('Connections Synchronization and Chat Row Mapping', () => {
  it('maps ChatConnection to ChatConnectionRow with string chatId and normalized properties', () => {
    const row = toChatConnectionRow({
      id: 'conn-1',
      botId: 'bot-1',
      chatId: '-1002488392193',
      title: 'Admin Supergroup',
      type: 'supergroup',
      username: 'adminsupergroup',
      isActive: 1,
      createdAt: '2026-10-19T12:00:00Z',
    });

    expect(row.id).toBe('conn-1');
    expect(row.botId).toBe('bot-1');
    expect(row.bot_id).toBe('bot-1');
    expect(row.chatId).toBe('-1002488392193');
    expect(row.chat_id).toBe('-1002488392193');
    expect(row.type).toBe('supergroup');
    expect(row.isActive).toBe(1);
    expect(row.is_active).toBe(1);
  });

  it('preserves exact 64-bit Telegram chat id strings without numeric overflow', () => {
    const hugeChatId = '-100912345678901234';
    const row = toChatConnectionRow({
      id: 'conn-2',
      botId: 'bot-1',
      chatId: hugeChatId,
      title: 'High ID Supergroup',
      type: 'supergroup',
      username: null,
      isActive: 1,
      createdAt: null,
    });

    expect(row.chatId).toBe(hugeChatId);
    expect(row.chat_id).toBe(hugeChatId);
    expect(String(row.chat_id)).toBe(hugeChatId);
  });

  it('correctly maps type from supergroup to regular group', () => {
    const row = toChatConnectionRow({
      id: 'conn-3',
      botId: 'bot-1',
      chatId: '-1002488392193',
      title: 'Converted Group',
      type: 'group',
      username: null,
      isActive: 1,
      createdAt: '2026-10-19T12:00:00Z',
    });

    expect(row.type).toBe('group');
  });
});
