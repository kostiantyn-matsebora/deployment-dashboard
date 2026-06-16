import { createHash } from 'crypto';

/**
 * Computes a strong ETag from a serializable value.
 *
 * The value is JSON-serialised and SHA-256-hashed so the ETag:
 *  - Changes whenever the response body changes (content-derived).
 *  - Is stable across repeated calls with the same data.
 *  - Matches GitHub's strong ETag format: `"<hex>"`.
 */
export function computeEtag(value: unknown): string {
  const json = JSON.stringify(value);
  const hash = createHash('sha256').update(json, 'utf8').digest('hex');
  return `"${hash}"`;
}
