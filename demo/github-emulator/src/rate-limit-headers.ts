import { Response } from 'express';
import { getConfig } from './config/configuration';

/**
 * Simulated per-process rate-limit budget.
 * Decrements per request and rolls over each hour.
 */
export class RateLimitBudget {
  private readonly limit: number;
  private used: number = 0;
  private windowStart: number;

  constructor(limit?: number) {
    this.limit = limit ?? getConfig().githubSimRateLimit;
    this.windowStart = this.currentHourEpoch();
  }

  private currentHourEpoch(): number {
    const now = Date.now();
    return Math.floor(now / 3_600_000) * 3_600;
  }

  private rolloverIfNeeded(): void {
    const epoch = this.currentHourEpoch();
    if (epoch > this.windowStart) {
      this.used = 0;
      this.windowStart = epoch;
    }
  }

  consume(): void {
    this.rolloverIfNeeded();
    this.used = Math.min(this.used + 1, this.limit);
  }

  snapshot(): { limit: number; remaining: number; used: number; reset: number } {
    this.rolloverIfNeeded();
    return {
      limit:     this.limit,
      remaining: Math.max(this.limit - this.used, 0),
      used:      this.used,
      reset:     this.windowStart + 3_600,
    };
  }
}

/** Process-global singleton — shared across all controllers. */
export const globalBudget = new RateLimitBudget();

/**
 * Adds X-RateLimit-* headers to every response and consumes one unit from
 * the simulated budget.
 */
export function applyRateLimitHeaders(res: Response, budget: RateLimitBudget = globalBudget): void {
  budget.consume();
  const snap = budget.snapshot();
  res.setHeader('X-RateLimit-Limit',     String(snap.limit));
  res.setHeader('X-RateLimit-Remaining', String(snap.remaining));
  res.setHeader('X-RateLimit-Used',      String(snap.used));
  res.setHeader('X-RateLimit-Reset',     String(snap.reset));
}

/**
 * Writes X-RateLimit-* headers WITHOUT consuming a unit from the budget.
 *
 * Use for:
 *  - `304 Not Modified` conditional-request responses (GitHub does not charge
 *    conditional hits against the rate-limit quota).
 *  - `GET /rate_limit` (GitHub exempt — checking remaining budget is free).
 */
export function applyRateLimitHeadersReadOnly(res: Response, budget: RateLimitBudget = globalBudget): void {
  const snap = budget.snapshot();
  res.setHeader('X-RateLimit-Limit',     String(snap.limit));
  res.setHeader('X-RateLimit-Remaining', String(snap.remaining));
  res.setHeader('X-RateLimit-Used',      String(snap.used));
  res.setHeader('X-RateLimit-Reset',     String(snap.reset));
}

/**
 * Adds a Link header pointing to the next page when one exists.
 * baseUrl should be the full path including existing query parameters.
 */
export function applyLinkHeader(
  res: Response,
  owner: string,
  repo: string,
  pathSegment: string,
  currentPage: number,
  perPage: number,
  totalItems: number,
): void {
  const hasNextPage = currentPage * perPage < totalItems;
  if (!hasNextPage) return;

  const nextPage = currentPage + 1;
  const nextUrl  = `/repos/${owner}/${repo}/${pathSegment}?per_page=${perPage}&page=${nextPage}`;
  res.setHeader('Link', `<${nextUrl}>; rel="next"`);
}
