import { Injectable, OnModuleInit } from '@nestjs/common';
import { GithubStore, globalStore } from './github-store';
import { GithubFixtureLoader } from './github-fixture-loader';
import { GithubRandomGenerator } from './github-random-generator';
import { getConfig } from './config/configuration';

export interface GithubStoreStatus {
  dataset:      string;
  repos:        number;
  deployments:  number;
  statuses:     number;
  workflows:    number;
  environments: number;
  emitting:     boolean;
  seeded_at:    string | null;
}

@Injectable()
export class GithubStoreService implements OnModuleInit {
  private readonly store: GithubStore = globalStore;
  private emitting = false;
  private emitTimer: ReturnType<typeof setInterval> | null = null;
  private readonly fixtureLoader = new GithubFixtureLoader();
  private readonly randomGenerator = new GithubRandomGenerator();

  onModuleInit(): void {
    const cfg = getConfig();
    if (cfg.seedOnStartup) {
      try {
        this.seedDemo();
        console.log('[github-emulator] seeded demo dataset on startup');
      } catch (err) {
        console.warn('[github-emulator] startup seed failed', err);
      }
    }
  }

  // ── Seed / clear ─────────────────────────────────────────────────────────────

  seed(dataset: 'demo' | 'random', count: number = 5, reset: boolean = false): GithubStoreStatus {
    if (reset) this.store.clear();

    if (dataset === 'demo') {
      this.seedDemo();
    } else {
      this.seedRandom(count);
    }

    return this.status();
  }

  clear(): GithubStoreStatus {
    this.stopEmit();
    this.store.clear();
    return this.status();
  }

  private seedDemo(): void {
    const cfg = getConfig();
    this.fixtureLoader.load(this.store, cfg.scenariosDir);
    this.store.setDataset('demo');
  }

  private seedRandom(count: number): void {
    this.randomGenerator.generate(this.store, count);
    this.store.setDataset('random');
  }

  // ── Emit control ─────────────────────────────────────────────────────────────

  getEmitStatus(): { emitting: boolean } {
    return { emitting: this.emitting };
  }

  setEmit(enabled: boolean): { emitting: boolean } {
    if (enabled && !this.emitting) {
      this.startEmit();
    } else if (!enabled && this.emitting) {
      this.stopEmit();
    }
    return { emitting: this.emitting };
  }

  toggleEmit(): { emitting: boolean } {
    return this.setEmit(!this.emitting);
  }

  private startEmit(): void {
    const cfg = getConfig();
    this.emitting = true;
    this.emitTimer = setInterval(() => {
      try {
        this.randomGenerator.appendRandomEmit(this.store);
      } catch (err) {
        console.warn('[github-emulator] emit error', err);
      }
    }, cfg.emitIntervalMs);
  }

  private stopEmit(): void {
    this.emitting = false;
    if (this.emitTimer) {
      clearInterval(this.emitTimer);
      this.emitTimer = null;
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  status(): GithubStoreStatus {
    const summary = this.store.summary();
    return {
      ...summary,
      emitting:  this.emitting,
      seeded_at: this.store.seededAt,
    };
  }

  /** Expose store for controllers. */
  getStore(): GithubStore {
    return this.store;
  }
}
