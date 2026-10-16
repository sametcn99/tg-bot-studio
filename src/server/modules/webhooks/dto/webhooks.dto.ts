import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/**
 * Outgoing webhook endpoint creation payload. The URL additionally goes
 * through the SSRF guard in the service (scheme + private-range checks).
 */
export class CreateWebhookEndpointDto {
  /** Absolute http(s) target URL. */
  @IsString()
  @Length(1, 500)
  url!: string;

  /** HMAC-SHA256 signing secret. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;

  /** Subscribed event names (empty = all events). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64)
  events?: string[];
}
