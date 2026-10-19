import { describe, expect, test } from 'bun:test';
import { openSecret, sealSecret } from '../common/utils/secret-box.util';

describe('secret box', () => {
  test('roundtrips a session string', () => {
    const sealed = sealSecret('1-session-payload-abc', 'studio-secret');
    expect(sealed.startsWith('v1:')).toBeTrue();
    expect(sealed).not.toContain('session-payload');
    expect(openSecret(sealed, 'studio-secret')).toBe('1-session-payload-abc');
  });

  test('different plaintexts seal differently (random iv)', () => {
    const a = sealSecret('same', 'key');
    const b = sealSecret('same', 'key');
    expect(a).not.toBe(b);
    expect(openSecret(a, 'key')).toBe('same');
    expect(openSecret(b, 'key')).toBe('same');
  });

  test('wrong key material fails', () => {
    const sealed = sealSecret('payload', 'key-a');
    expect(() => openSecret(sealed, 'key-b')).toThrow();
  });

  test('tampered ciphertext fails', () => {
    const sealed = sealSecret('payload', 'key');
    const parts = sealed.split(':');
    const flipped = (Number(parts[3][0].charCodeAt(0)) ^ 1).toString();
    const tampered = [parts[0], parts[1], parts[2], flipped + parts[3].slice(1)].join(':');
    expect(() => openSecret(tampered, 'key')).toThrow();
  });

  test('malformed envelope fails', () => {
    expect(() => openSecret('not-a-box', 'key')).toThrow(/Malformed/);
    expect(() => openSecret('v2:a:b:c', 'key')).toThrow(/Malformed/);
  });
});
