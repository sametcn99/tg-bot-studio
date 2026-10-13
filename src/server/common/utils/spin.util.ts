/**
 * Spin wheel prize weight and draw algorithms.
 * @module common/utils/spin
 */

export interface SpinPrize {
  label: string;
  points: number;
  weight?: number;
}

/**
 * Calculates odds weights for spin prizes.
 * If explicit `weight` (>0) is configured, it is respected.
 * Otherwise, uses inverse weighting where higher points produce lower probability (1000 / points).
 *
 * @param {SpinPrize[]} prizes - Prize definitions.
 * @returns {number[]} Array of positive integer weights.
 */
export function calculatePrizeWeights(prizes: SpinPrize[]): number[] {
  return prizes.map((prize) => {
    if (typeof prize.weight === 'number' && prize.weight > 0) {
      return Math.max(1, Math.round(prize.weight));
    }
    const pts = Math.max(1, Number(prize.points) || 1);
    return Math.max(1, Math.round(1000 / pts));
  });
}

/**
 * Deterministically draws a prize from the pool given a normalized roll (0 to totalWeight).
 *
 * @param {SpinPrize[]} prizes - Prize pool.
 * @param {number[]} weights - Pre-calculated weights matching prizes.
 * @param {number} roll - Numeric roll between 0 and totalWeight.
 * @returns {SpinPrize} Selected prize.
 */
export function drawPrizeByRoll(prizes: SpinPrize[], weights: number[], roll: number): SpinPrize {
  if (prizes.length === 0) {
    throw new Error('Prize pool cannot be empty');
  }
  let remaining = roll;
  for (let i = 0; i < prizes.length; i++) {
    remaining -= weights[i]!;
    if (remaining <= 0) {
      return prizes[i]!;
    }
  }
  return prizes[prizes.length - 1]!;
}
