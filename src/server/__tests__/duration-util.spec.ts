import { describe, expect, test } from 'bun:test';
import { formatDuration, parseDuration, splitDurationArg } from '../common/utils/duration.util';

describe('parseDuration', () => {
  test('parses single units', () => {
    expect(parseDuration('5m')).toBe(300);
    expect(parseDuration('2h')).toBe(7_200);
    expect(parseDuration('3d')).toBe(259_200);
    expect(parseDuration('2w')).toBe(1_209_600);
    expect(parseDuration('30s')).toBe(30);
  });

  test('parses compound durations', () => {
    expect(parseDuration('1h30m')).toBe(5_400);
    expect(parseDuration('1d12h')).toBe(129_600);
    expect(parseDuration('1 h 30 m')).toBe(5_400);
  });

  test('treats bare numbers as minutes', () => {
    expect(parseDuration('45')).toBe(2_700);
  });

  test('rejects invalid input', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('nope')).toBeNull();
    expect(parseDuration('0m')).toBeNull();
  });
});

describe('splitDurationArg', () => {
  test('splits duration and reason', () => {
    expect(splitDurationArg('3d cool off')).toEqual({ seconds: 259_200, rest: 'cool off' });
    expect(splitDurationArg('1h30m flooding')).toEqual({ seconds: 5_400, rest: 'flooding' });
  });

  test('keeps non-duration text intact', () => {
    expect(splitDurationArg('some reason here')).toEqual({
      seconds: null,
      rest: 'some reason here',
    });
  });
});

describe('formatDuration', () => {
  test('round-trips compact forms', () => {
    expect(formatDuration(259_200)).toBe('3d');
    expect(formatDuration(1_209_600)).toBe('2w');
    expect(formatDuration(7_200)).toBe('2h');
    expect(formatDuration(2_700)).toBe('45m');
  });
});
