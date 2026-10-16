import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { validateInitData } from '../common/utils/telegram.util';

describe('Telegram Mini App initData HMAC validation', () => {
  const botToken = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';

  function generateValidInitData(params: Record<string, string>, token: string): string {
    const searchParams = new URLSearchParams(params);
    const dataCheckString = [...searchParams.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    searchParams.set('hash', hash);
    return searchParams.toString();
  }

  function freshAuthDate(): string {
    return String(Math.floor(Date.now() / 1000));
  }

  it('validates a legitimate fresh initData string and extracts user id', () => {
    const userPayload = JSON.stringify({
      id: 987654321,
      first_name: 'Antigravity',
      username: 'dev',
    });
    const initData = generateValidInitData(
      {
        auth_date: freshAuthDate(),
        query_id: 'AAHdF6IQAAAAAN0XohDhrP_1',
        user: userPayload,
      },
      botToken,
    );

    const result = validateInitData(initData, botToken);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(987654321);
  });

  it('rejects replayed initData older than the freshness window', () => {
    const initData = generateValidInitData(
      {
        auth_date: '1700000000', // Nov 2023 — long expired
        user: JSON.stringify({ id: 11111 }),
      },
      botToken,
    );

    const result = validateInitData(initData, botToken);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('accepts old initData only within an explicit (test) freshness override', () => {
    const initData = generateValidInitData(
      {
        auth_date: '1700000000',
        user: JSON.stringify({ id: 42 }),
      },
      botToken,
    );

    const result = validateInitData(initData, botToken, 10 * 365 * 24 * 60 * 60);
    expect(result.valid).toBe(true);
  });

  it('rejects tampered initData with altered parameters', () => {
    const validInitData = generateValidInitData(
      {
        auth_date: freshAuthDate(),
        user: JSON.stringify({ id: 11111 }),
      },
      botToken,
    );

    // Tamper with user id in query string without re-signing
    const tampered = validInitData.replace('11111', '99999');
    const result = validateInitData(tampered, botToken);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature');
  });

  it('rejects initData signed with a different bot token', () => {
    const differentToken = '987654321:XYZ-different-token';
    const initData = generateValidInitData(
      {
        auth_date: freshAuthDate(),
        user: JSON.stringify({ id: 42 }),
      },
      differentToken,
    );

    const result = validateInitData(initData, botToken);
    expect(result.valid).toBe(false);
  });

  it('rejects malformed or empty initData strings', () => {
    expect(validateInitData('', botToken).valid).toBe(false);
    expect(validateInitData('not-a-valid-query-string', botToken).valid).toBe(false);
    expect(validateInitData('auth_date=1700000000', botToken).valid).toBe(false);
  });
});
