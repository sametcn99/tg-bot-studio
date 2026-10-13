import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body for registering a new bot obtained from BotFather.
 */
export class CreateBotDto {
  /**
   * Full Telegram bot API token (format `id:secret`).
   * @type {string}
   */
  @IsString()
  @MinLength(10)
  token!: string;

  /**
   * Operator-chosen display name; defaults to the bot's Telegram name.
   * @type {string}
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

/**
 * Request body for updating bot metadata or enabled state.
 */
export class UpdateBotDto {
  /**
   * Replacement display name.
   * @type {string}
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /**
   * When false the bot poller is stopped without deleting the record.
   * @type {boolean}
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Request body for validating a token before persistence.
 */
export class ValidateTokenDto {
  /**
   * Full Telegram bot API token to verify via getMe.
   * @type {string}
   */
  @IsString()
  @MinLength(10)
  token!: string;
}

/**
 * Request body for toggling or reconfiguring a module on a bot.
 */
export class UpdateModuleStateDto {
  /**
   * Whether the module middleware should be attached to the runtime.
   * @type {boolean}
   */
  @IsBoolean()
  isEnabled!: boolean;

  /**
   * Full module configuration object (validated per module by the UI).
   * @type {Record<string, unknown>}
   */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
