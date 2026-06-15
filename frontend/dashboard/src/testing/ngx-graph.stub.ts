/**
 * Lightweight stub for @swimlane/ngx-graph used by unit tests.
 *
 * The real package pulls in dagre + webcola which allocates hundreds of MB
 * in jsdom and causes a fatal V8 heap OOM in the vitest worker.  This stub
 * replaces the entire package so the heavy layout engine is never loaded.
 *
 * Wired via the `resolve.alias` in vitest.config.ts → `runnerConfig` in
 * angular.json so ALL spec files share the same lightweight stub
 * transparently — no per-spec vi.mock() boilerplate needed.
 */
import { Component, EventEmitter, Input, NgModule, Output } from '@angular/core';

@Component({
  selector:   'ngx-graph',
  standalone: false,
  template:   '',
})
export class GraphComponent {
  @Input() nodes:   unknown[] = [];
  @Input() links:   unknown[] = [];
  @Input() view:    unknown;
  @Input() update$: unknown;
  @Output() stateChange = new EventEmitter<unknown>();
}

@NgModule({
  declarations: [GraphComponent],
  exports:      [GraphComponent],
})
export class NgxGraphModule {}

// Type stubs — values are not used at runtime; the component only needs the types.
export class Node  { id = ''; }
export class Edge  { id = ''; source = ''; target = ''; }
export const NgxGraphStates = {} as const;
