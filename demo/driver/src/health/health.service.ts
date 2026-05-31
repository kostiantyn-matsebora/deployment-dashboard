import { Injectable } from '@nestjs/common';
import { getConfig } from '../config/configuration';

/** Per-component liveness result. */
export type ComponentStatus = 'up' | 'down';

/** Aggregated liveness for all components. */
export interface HealthStatus {
  driver:   'up';
  api:      ComponentStatus;
  emulator: ComponentStatus;
  fetcher:  ComponentStatus;
}

/** Probe timeout — ≤ 2 s per §4.10. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Liveness-aggregator service.
 *
 * Issues three probes in parallel (Promise.all), each bounded by a 2 s
 * AbortController timeout.  A 2xx response → "up"; any non-2xx, timeout,
 * or network error → "down".  The driver component is always "up" — if
 * the panel can reach this endpoint the driver is running.
 *
 * Uses globalThis.fetch so tests can substitute the fetch implementation.
 */
@Injectable()
export class HealthService {
  async check(): Promise<HealthStatus> {
    const config = getConfig();

    const [api, emulator, fetcher] = await Promise.all([
      this._probe(`${config.writeApiUrl}/healthz`),
      this._probe(`${config.githubEmulatorUrl}/_github/status`),
      this._probe(`${config.fetcherUrl}/health`),
    ]);

    return { driver: 'up', api, emulator, fetcher };
  }

  private async _probe(url: string): Promise<ComponentStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const response = await (globalThis.fetch as typeof fetch)(url, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
