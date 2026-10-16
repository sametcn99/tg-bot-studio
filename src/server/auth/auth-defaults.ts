/**
 * Default credential constants shared by the auth module, the JWT strategy,
 * the security-posture check, and the production boot guard. Keeping them in
 * one place prevents the check/actual-fallback drift that silently disabled
 * the default-secret warning.
 */

/** Fallback master key used when `ADMIN_MASTER_KEY` is not configured. */
export const DEFAULT_MASTER_KEY = 'admin123';

/** Fallback JWT signing secret used when `JWT_SECRET` is not configured. */
export const DEFAULT_JWT_SECRET = 'change_this_secret_in_production';

/**
 * @returns {boolean} True when the studio would run with the documented
 * default master key (either unset or explicitly `admin123`).
 */
export function isDefaultMasterKeyEnv(): boolean {
  const value = process.env.ADMIN_MASTER_KEY;
  return !value || value === DEFAULT_MASTER_KEY;
}

/**
 * @returns {boolean} True when the studio would sign JWTs with the documented
 * default secret (either unset or explicitly the fallback string).
 */
export function isDefaultJwtSecretEnv(): boolean {
  const value = process.env.JWT_SECRET;
  return !value || value === DEFAULT_JWT_SECRET;
}

/**
 * Resolves the effective master key, falling back to the documented default
 * outside production. The production boot guard refuses to start on the
 * default, so this fallback only ever applies to local development.
 * @returns {string} Master key from the environment or the default.
 */
export function resolveMasterKey(): string {
  return process.env.ADMIN_MASTER_KEY || DEFAULT_MASTER_KEY;
}

/**
 * Resolves the effective JWT signing secret with the same production guard.
 * @returns {string} Secret from the environment or the default.
 */
export function resolveJwtSecret(): string {
  return process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
}
