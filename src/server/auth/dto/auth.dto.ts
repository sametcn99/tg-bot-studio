import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body for authenticating against the studio master key.
 */
export class LoginDto {
  /**
   * The studio master key (initially seeded from `ADMIN_MASTER_KEY`).
   * @type {string}
   */
  @IsString()
  @MinLength(1)
  masterKey!: string;
}

/**
 * Request body for rotating the studio master key.
 */
export class ChangeMasterKeyDto {
  /**
   * Current master key, required for verification before rotation.
   * @type {string}
   */
  @IsString()
  @MinLength(1)
  currentKey!: string;

  /**
   * Replacement master key (8-128 characters).
   * @type {string}
   */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newKey!: string;
}
