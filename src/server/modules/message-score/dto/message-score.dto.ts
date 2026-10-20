import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Leaderboard period bucket. */
const PERIODS = ['daily', 'weekly', 'monthly', 'alltime'] as const;

/** Schedule recurrence shape. */
const FREQUENCIES = ['once', 'hourly', 'daily', 'weekly'] as const;

/**
 * Shared payload for leaderboard preview/send and schedule create/update.
 * Every field is an optional patch; the service applies the same
 * normalization and defaults as before — the DTO adds boundary type/length
 * enforcement that previously did not exist.
 */
export class ScorePayloadDto {
  /** Display name (schedules). */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  /** Single target chat (legacy shorthand). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  chatId?: string;

  /** Target chat ids. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  chatIds?: string[];

  /** Leaderboard period bucket. */
  @IsOptional()
  @IsIn(PERIODS)
  period?: (typeof PERIODS)[number];

  /** Schedule recurrence. */
  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: (typeof FREQUENCIES)[number];

  /** Wall-clock time of day (HH:mm). */
  @IsOptional()
  @Matches(/^\d{1,2}:\d{2}$/)
  timeOfDay?: string;

  /** Target weekday for weekly recurrences (0=Sunday). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  /** Explicit first-run instant (once schedules). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  runAt?: string;

  /** Leaderboard row cap. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topLimit?: number;

  /** Message header template. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  headerText?: string;

  /** Per-member row template. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rowTemplate?: string;

  /** Message footer template. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  footerText?: string;

  /** Telegram parse mode. */
  @IsOptional()
  @IsIn(['HTML', 'Markdown', 'None'])
  parseMode?: string;

  /** Prepend rank medals. */
  @IsOptional()
  @IsBoolean()
  medals?: boolean;

  /** Send silently. */
  @IsOptional()
  @IsBoolean()
  disableNotification?: boolean;

  /** Schedule lifecycle state. */
  @IsOptional()
  @IsIn(['active', 'done'])
  status?: string;

  /** Convenience active toggle (update). */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
