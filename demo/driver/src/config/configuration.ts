export interface AppConfig {
  port:           number;
  writeApiUrl:    string;
  apiKey:         string;
  controlApiKey:  string;
  scenariosDir:   string;
  emitDelayMs:    number;
  emitIntervalMs: number;
}

export function getConfig(): AppConfig {
  return {
    port:           parseInt(process.env.PORT           ?? '3001',  10),
    writeApiUrl:    process.env.WRITE_API_URL            ?? 'http://localhost:3000',
    apiKey:         process.env.API_KEY                  ?? 'dev-secret',
    controlApiKey:  process.env.CONTROL_API_KEY          ?? 'dev-secret',
    scenariosDir:   process.env.SCENARIOS_DIR            ?? '../../demo/data',
    emitDelayMs:    parseInt(process.env.EMIT_DELAY_MS   ?? '0',    10),
    emitIntervalMs: parseInt(process.env.EMIT_INTERVAL_MS ?? '8000', 10),
  };
}
