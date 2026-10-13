import { describe, expect, it } from 'bun:test';
import { renderTemplate } from '../common/utils/template.util';

describe('Message Template Placeholder Rendering', () => {
  it('interpolates known user placeholders correctly', () => {
    const template = 'Welcome {first_name} {last_name} (@{username})! Your id is {user_id}.';
    const context = {
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
      user_id: 12345678,
    };

    const result = renderTemplate(template, context);
    expect(result).toBe('Welcome John Doe (@johndoe)! Your id is 12345678.');
  });

  it('interpolates leaderboard and date/time tokens', () => {
    const template = '{medal} Rank #{rank}: {name} with {score} pts ({date} {time})';
    const context = {
      medal: '🥇',
      rank: 1,
      name: 'LeaderBot',
      score: 950,
      date: '2026-10-13',
      time: '18:00',
    };

    const result = renderTemplate(template, context);
    expect(result).toBe('🥇 Rank #1: LeaderBot with 950 pts (2026-10-13 18:00)');
  });

  it('preserves unknown or undefined placeholders untouched without crashing', () => {
    const template = 'Hello {first_name}, your balance is {unknown_token}!';
    const context = {
      first_name: 'Alice',
    };

    const result = renderTemplate(template, context);
    expect(result).toBe('Hello Alice, your balance is {unknown_token}!');
  });

  it('handles templates with no placeholders or empty string', () => {
    expect(renderTemplate('Simple static text', {})).toBe('Simple static text');
    expect(renderTemplate('', { first_name: 'Bob' })).toBe('');
  });
});
