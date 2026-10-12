/**
 * Dependency-free user agent inspection used to enrich session records.
 * @module common/utils/user-agent
 */

/**
 * Parsed user agent details persisted in the `sessions` table.
 * @interface ParsedUserAgent
 * @property {string} browser - Human-readable browser name and major version.
 * @property {string} os - Operating system name.
 * @property {string} deviceType - One of `desktop`, `mobile`, or `tablet`.
 */
export interface ParsedUserAgent {
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
}

/**
 * Extracts browser, operating system, and device type from a raw
 * `User-Agent` header value using conservative regex matching.
 *
 * @param {string} [userAgent] - Raw header value; may be undefined.
 * @returns {ParsedUserAgent} Parsed attributes with `Unknown` fallbacks.
 * @example
 * parseUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0');
 */
export function parseUserAgent(userAgent?: string): ParsedUserAgent {
  const ua = userAgent || '';

  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  let os = 'Unknown';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  if (/ipad|tablet/i.test(ua)) deviceType = 'tablet';
  else if (/mobi|iphone|android/i.test(ua)) deviceType = 'mobile';

  return { browser, os, deviceType };
}
