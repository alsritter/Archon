/**
 * Feishu/Lark user authorization utilities
 * Parses and validates open IDs for whitelist-based access control.
 */

/**
 * Parse comma-separated Feishu open IDs from environment variable.
 * Returns empty array if not set or invalid (open access mode).
 */
export function parseAllowedOpenIds(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim() === '') {
    return [];
  }

  return envValue
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '');
}

/**
 * Check if a Feishu user open_id is authorized.
 * Returns true if:
 * - allowedOpenIds is empty (open access mode)
 * - openId is in allowedOpenIds
 */
export function isOpenIdAuthorized(openId: string | undefined, allowedOpenIds: string[]): boolean {
  if (allowedOpenIds.length === 0) {
    return true;
  }

  if (!openId || openId.trim() === '') {
    return false;
  }

  return allowedOpenIds.includes(openId);
}
