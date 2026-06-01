export interface AppConfig {
  port:              number;
  githubSimRateLimit: number;
  seedOnStartup:     boolean;
  scenariosDir:      string;
  emitIntervalMs:    number;
}

export function getConfig(): AppConfig {
  return {
    port:              parseInt(process.env.PORT                   ?? '3100',  10),
    githubSimRateLimit: parseInt(process.env.GITHUB_SIM_RATE_LIMIT ?? '5000',  10),
    seedOnStartup:     (process.env.SEED_ON_STARTUP               ?? 'true') === 'true',
    scenariosDir:      process.env.SCENARIOS_DIR                  ?? '../../demo/data',
    emitIntervalMs:    parseInt(process.env.EMIT_INTERVAL_MS      ?? '8000',  10),
  };
}
