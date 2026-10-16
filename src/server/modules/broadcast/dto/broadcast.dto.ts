import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Inbound broadcast button descriptor.
 */
export class BroadcastButtonDto {
  /** Inline button label. */
  @IsString()
  @Length(1, 64)
  text!: string;

  /** Inline button target URL. */
  @IsString()
  @Length(1, 500)
  url!: string;
}

/**
 * One A/B variant payload.
 */
export class BroadcastVariantDto {
  /** Variant label ("A", "B", ...). */
  @IsOptional()
  @IsString()
  @Length(1, 20)
  label?: string;

  /** Variant message text. */
  @IsString()
  @Length(1, 4096)
  messageText!: string;

  /** Optional variant media. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaUrl?: string;

  /** Optional variant buttons. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BroadcastButtonDto)
  buttons?: BroadcastButtonDto[];
}

/**
 * Broadcast creation payload (single broadcast or up to 3 A/B variants).
 */
export class CreateBroadcastDto {
  /** Audience selector. */
  @IsOptional()
  @IsIn(['all', 'language', 'recent'])
  targetType?: 'all' | 'language' | 'recent';

  /** Required when `targetType=language`. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  /** Required when `targetType=recent` (days). */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  recentDays?: number;

  /** Message text (Telegram HTML allowed). */
  @IsString()
  @Length(1, 4096)
  messageText!: string;

  /** Optional media URL. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaUrl?: string;

  /** Optional inline buttons. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BroadcastButtonDto)
  buttons?: BroadcastButtonDto[];

  /** A/B variants (2-3 entries switch the payload into experiment mode). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => BroadcastVariantDto)
  variants?: BroadcastVariantDto[];

  /** Deterministic test split size in percent. */
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(50)
  testSplitPercent?: number;
}
