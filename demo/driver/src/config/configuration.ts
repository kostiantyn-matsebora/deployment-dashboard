export interface AppConfig {
  port:               number;
  writeApiUrl:        string;
  apiKey:             string;
  controlApiKey:      string;
  componentId:        string;
  resetGateMaxTtlMs:  number;
  scenariosDir:       string;
  emitDelayMs:        number;
  emitIntervalMs:     number;
  githubEmulatorUrl:  string;
  fetcherUrl:         string;
}

export function getConfig(): AppConfig {
  return {
    port:               parseInt(process.env.PORT                ?? '3001',  10),
    writeApiUrl:        process.env.WRITE_API_URL                ?? 'http://localhost:3002',
    apiKey:             process.env.API_KEY                      ?? 'dev-secret',
    controlApiKey:      process.env.CONTROL_API_KEY              ?? 'dev-secret',
    componentId:        process.env.COMPONENT_ID                 ?? 'demo-driver',
    resetGateMaxTtlMs:  parseInt(process.env.RESET_GATE_MAX_TTL_MS ?? '90000', 10),
    scenariosDir:       process.env.SCENARIOS_DIR                ?? '../../demo/data',
    emitDelayMs:        parseInt(process.env.EMIT_DELAY_MS       ?? '0',    10),
    emitIntervalMs:     parseInt(process.env.EMIT_INTERVAL_MS    ?? '8000', 10),
    githubEmulatorUrl:  process.env.GITHUB_EMULATOR_URL          ?? 'http://localhost:3100',
    fetcherUrl:         process.env.FETCHER_URL                  ?? 'http://localhost:8080',
  };
}
