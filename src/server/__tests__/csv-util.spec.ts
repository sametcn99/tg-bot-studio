import { describe, expect, it } from 'bun:test';
import { toCsv } from '../common/utils/csv.util';

describe('CSV Serializer & RFC 4180 Escaping', () => {
  it('serializes standard rows to CSV with header', () => {
    const data = [
      { id: 1, name: 'Alice', points: 100 },
      { id: 2, name: 'Bob', points: 250 },
    ];

    const csv = toCsv(data);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,name,points');
    expect(lines[1]).toBe('1,Alice,100');
    expect(lines[2]).toBe('2,Bob,250');
  });

  it('escapes cells containing commas, double quotes, and newlines', () => {
    const data = [
      {
        id: 1,
        title: 'Book, "Special Edition"',
        note: 'Line 1\nLine 2',
      },
    ];

    const csv = toCsv(data);
    expect(csv).toContain('"Book, ""Special Edition"""');
    expect(csv).toContain('"Line 1\nLine 2"');
  });

  it('respects explicit column order', () => {
    const data = [{ a: 1, b: 2, c: 3 }];
    const csv = toCsv(data, ['c', 'a']);
    expect(csv.split('\r\n')[0]).toBe('c,a');
    expect(csv.split('\r\n')[1]).toBe('3,1');
  });

  it('handles empty datasets gracefully', () => {
    expect(toCsv([])).toBe('');
  });
});
