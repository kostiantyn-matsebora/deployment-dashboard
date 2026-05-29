export interface FetcherState {
  adapter: string;
  cursor: string;
  updated_at: string;
}

class FetcherStore {
  private readonly map = new Map<string, FetcherState>();

  get(adapter: string): FetcherState | undefined {
    return this.map.get(adapter);
  }

  set(adapter: string, cursor: string): void {
    this.map.set(adapter, { adapter, cursor, updated_at: new Date().toISOString() });
  }

  adapters(): string[] {
    return [...this.map.keys()];
  }

  clear(): void {
    this.map.clear();
  }
}

export const fetcherStore = new FetcherStore();
