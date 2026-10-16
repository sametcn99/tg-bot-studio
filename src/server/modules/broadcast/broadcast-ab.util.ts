/**
 * Pure, side-effect-free helpers for the broadcast A/B engine. Kept separate
 * from the service so the deterministic assignment and winner scoring logic
 * can be unit-tested without Prisma or a Telegram client.
 */

/**
 * Deterministic 0-99 bucket of a telegram id (stable A/B assignment across
 * restarts and audience growth).
 * @param {bigint | number | string} telegramId - Recipient telegram id.
 * @returns {number} Bucket in the range [0, 99].
 */
export function audienceBucket(telegramId: bigint | number | string): number {
  const id = telegramId.toString();
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Whether a recipient belongs to the experiment's test split.
 * @param {bigint | number | string} telegramId - Recipient telegram id.
 * @param {number} testSplitPercent - Split size in percent (0-100).
 * @returns {boolean} True when the recipient is in the test slice.
 */
export function isInTestSplit(
  telegramId: bigint | number | string,
  testSplitPercent: number,
): boolean {
  return audienceBucket(telegramId) < testSplitPercent;
}

/**
 * Variant index a test-split recipient receives (stable across restarts).
 * @param {bigint | number | string} telegramId - Recipient telegram id.
 * @param {number} variantCount - Number of variants in the experiment.
 * @returns {number} Variant index in [0, variantCount).
 */
export function variantIndexFor(
  telegramId: bigint | number | string,
  variantCount: number,
): number {
  return audienceBucket(telegramId) % variantCount;
}

/**
 * Click-through-first ranking score for a finished variant: CTR dominates,
 * delivery rate breaks near-ties.
 * @param {object} row - Broadcast counters.
 * @param {number} row.clicks - Tracked button clicks.
 * @param {number} row.successCount - Delivered messages.
 * @param {number} row.totalRecipients - Attempted recipients.
 * @returns {number} Ranking score; higher wins.
 */
export function variantScore(row: {
  clicks: number;
  successCount: number;
  totalRecipients: number;
}): number {
  const delivered = Math.max(1, row.successCount);
  const ctr = row.clicks / delivered;
  const deliveryRate = row.totalRecipients > 0 ? row.successCount / row.totalRecipients : 0;
  return ctr * 1000 + deliveryRate;
}
