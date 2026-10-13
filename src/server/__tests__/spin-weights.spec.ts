import { describe, expect, it } from 'bun:test';
import { calculatePrizeWeights, drawPrizeByRoll, type SpinPrize } from '../common/utils/spin.util';

describe('Spin Wheel Prize Weights and Odds', () => {
  it('assigns lower probability (weight) to higher value prizes under inverse weighting', () => {
    const prizes: SpinPrize[] = [
      { label: 'Common (Small)', points: 10 },
      { label: 'Uncommon (Medium)', points: 50 },
      { label: 'Rare (Grand Jackpot)', points: 500 },
    ];

    const weights = calculatePrizeWeights(prizes);

    // 1000 / 10 = 100
    // 1000 / 50 = 20
    // 1000 / 500 = 2
    expect(weights[0]).toBe(100);
    expect(weights[1]).toBe(20);
    expect(weights[2]).toBe(2);

    // Common prize has ~50x higher chance than Grand Jackpot
    expect(weights[0]! > weights[1]!).toBe(true);
    expect(weights[1]! > weights[2]!).toBe(true);
  });

  it('respects explicit weight when configured by operator', () => {
    const prizes: SpinPrize[] = [
      { label: 'Custom Odds 1', points: 1000, weight: 80 },
      { label: 'Custom Odds 2', points: 10, weight: 20 },
    ];

    const weights = calculatePrizeWeights(prizes);
    expect(weights[0]).toBe(80);
    expect(weights[1]).toBe(20);
  });

  it('deterministically selects prize based on cumulative roll boundary', () => {
    const prizes: SpinPrize[] = [
      { label: 'A', points: 10 }, // weight: 100
      { label: 'B', points: 100 }, // weight: 10
      { label: 'C', points: 1000 }, // weight: 1
    ];
    const weights = calculatePrizeWeights(prizes);
    // Total = 111. Roll ranges: A: (0, 100], B: (100, 110], C: (110, 111]

    expect(drawPrizeByRoll(prizes, weights, 50).label).toBe('A');
    expect(drawPrizeByRoll(prizes, weights, 100).label).toBe('A');
    expect(drawPrizeByRoll(prizes, weights, 101).label).toBe('B');
    expect(drawPrizeByRoll(prizes, weights, 110).label).toBe('B');
    expect(drawPrizeByRoll(prizes, weights, 110.5).label).toBe('C');
  });
});
