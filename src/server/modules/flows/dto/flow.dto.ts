import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * Flow create/update payload. The graph itself is validated deeply by the
 * service (node ids/types, start reference, 100-node cap); the DTO enforces
 * the boundary shape and text caps.
 */
export class SaveFlowDto {
  /** Display name (required on create — enforced by the service too). */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  /** Trigger discriminator. */
  @IsOptional()
  @IsIn(['command', 'keyword', 'start'])
  triggerType?: string;

  /** Command (`/pricing`) or keyword text; empty for `start`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  triggerValue?: string;

  /** Flow graph object: `{ nodes: [...], start: nodeId }`. */
  @IsOptional()
  @IsObject()
  graph?: Record<string, unknown>;

  /** Flow graph as a pre-serialized JSON string (client save path). */
  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  graphJson?: string;

  /** Active flag (update). */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
