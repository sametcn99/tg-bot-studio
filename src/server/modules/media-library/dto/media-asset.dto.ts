import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { MEDIA_KINDS } from '../media-asset.constants';

/**
 * Shared media library asset creation payload. Validation mirrors the
 * service-level checks (url/file_id source, kind vocabulary) with boundary
 * length caps added.
 */
export class CreateMediaAssetDto {
  /** Display name. */
  @IsString()
  @Length(1, 120)
  name!: string;

  /** `url` (http(s) link) or `file_id` (Telegram file id). */
  @IsIn(['url', 'file_id'])
  source!: 'url' | 'file_id';

  /** The value modules consume — URL or raw file id. */
  @IsString()
  @Length(1, 2048)
  value!: string;

  /** Asset kind (photo/video/audio/document/animation). */
  @IsOptional()
  @IsIn(MEDIA_KINDS as unknown as string[])
  kind?: string;

  /** Free-form tags for filtering. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  tags?: string;
}
