import * as fs from 'fs';
import * as path from 'path';

// Raw event as stored in scenario JSON files.
// elapsed_minutes is stripped before posting to the Write API (D6).
export interface ScenarioEvent {
  deployment_id: string;
  service: string;
  environment: string;
  status: 'in-progress' | 'success' | 'failure';
  elapsed_minutes: number;
  version?: string;
  run_url?: string;
  run_number?: string;
  actor?: string;
  ref?: string;
  sha?: string;
  parent_deployments?: string[];
}

export interface Scenario {
  name: string;
  events: ScenarioEvent[];
}

function hasEventsArray(data: unknown): data is { events: ScenarioEvent[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'events' in data &&
    Array.isArray((data as { events: unknown }).events)
  );
}

/**
 * Scans scenariosDir for *.json files that match the events.json schema.
 * Names each scenario by filename without extension.
 * Returns empty array if directory is absent or unreadable.
 */
export function loadScenarios(scenariosDir: string): Scenario[] {
  const resolvedDir = path.resolve(scenariosDir);

  if (!fs.existsSync(resolvedDir)) {
    console.warn(`[demo-driver] scenarios dir not found: ${resolvedDir}`);
    return [];
  }

  const files = fs.readdirSync(resolvedDir).filter(f => f.endsWith('.json'));
  const scenarios: Scenario[] = [];

  for (const file of files) {
    const filePath = path.join(resolvedDir, file);
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (hasEventsArray(raw)) {
        scenarios.push({ name: file.replace(/\.json$/, ''), events: raw.events });
      } else {
        console.warn(`[demo-driver] skipping ${file}: missing events[]`);
      }
    } catch (err) {
      console.warn(`[demo-driver] skipping ${file}: parse error`, err);
    }
  }

  return scenarios;
}
