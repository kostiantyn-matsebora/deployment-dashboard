import { UnauthorizedException } from '@nestjs/common';

const CONFIGURED_KEY = process.env['API_KEY'] ?? 'dev-secret';

/**
 * Validates the X-Api-Key header against the configured key.
 * Throws 401 UnauthorizedException if missing or invalid.
 */
export function validateApiKey(key: string | undefined): void {
  if (!key || key !== CONFIGURED_KEY) {
    throw new UnauthorizedException({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing or invalid X-Api-Key.',
    });
  }
}
