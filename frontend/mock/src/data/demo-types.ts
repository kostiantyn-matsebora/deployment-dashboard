/** TypeScript types for demo/data/events.json — lives here because only the mock server needs them. */

export type DemoStatus =
  | 'in-progress'
  | 'success'
  | 'failure'
  | 'pending'
  | 'queued'
  | 'waiting'
  | 'cancelled'
  | 'rejected';

export interface DemoEvent {
  deployment_id: string;
  service: string;
  environment: string;
  status: DemoStatus;
  elapsed_minutes: number;
  version?: string;
  run_url?: string;
  run_number?: string;
  actor?: string;
  ref?: string;
  sha?: string;
  parent_deployments?: string[];
}

export type DemoSseTemplate = Omit<DemoEvent, 'elapsed_minutes'>;

export interface DemoData {
  services: string[];
  environments: string[];
  state_markers: Record<string, string>;
  events: DemoEvent[];
  sse_templates: DemoSseTemplate[];
}
