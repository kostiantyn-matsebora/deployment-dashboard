// Root component. Bootstraps the SSE subscription, primes the store from the
// REST API (with a fixture fallback so the dev experience works even before
// the backend is up), and hosts header + stats bar + per-layout body + drawer.
//
// FR-13 — the body is one of three layout components (Matrix / Swim-lane /
// Workflow-rows). The layout switcher lives in the header next to the view
// switcher. Layout selection persists in `localStorage` via `LayoutPrefsService`.
//
// SAD §7 "SSE topology semantics" + §10 Decision #8 — slot updates over
// SSE; topology is refreshed via `GET /api/deployments?correlationAttribute=…`
// after each event. Bursts inside a 250 ms window coalesce into a single
// GET. The picker's pick is the SOLE driver of the query parameter.
//
// Mockup header toggle "Focus on last event" — after each SSE event, if
// the toggle is ON we scroll the affected element into view and apply the
// 900 ms `swap-pulse` keyframe; if OFF we only pulse when the element is
// already in the viewport (data still updates either way).

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ApiClientService,
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES,
  FIXTURE_TOPOLOGY,
  FIXTURE_TOPOLOGY_CONFIG,
  SseService,
  type CorrelationAttribute,
  type EnvironmentDescriptor,
  type ServiceDescriptor,
  type SlotUpdatePayload
} from '@dd/shared';
import { PipelineMatrixComponent, StatsBarComponent } from '@dd/matrix';
import { HistoryDrawerComponent } from '@dd/drawer';
import { DashboardHeaderComponent } from './dashboard-header.component';
import { SwimLaneLayoutComponent } from './swim-lane-layout.component';
import { WorkflowRowsLayoutComponent } from './workflow-rows-layout.component';

/** SAD §"SSE topology semantics" — the coalescing window for follow-up GETs. */
const REFRESH_COALESCE_MS = 250;

/** Mockup `.swap-pulse` keyframe duration (docs/ui/deployment-dashboard.html line 204). */
const PULSE_MS = 900;

@Component({
  selector: 'dd-root',
  standalone: true,
  imports: [
    CommonModule,
    DashboardHeaderComponent,
    StatsBarComponent,
    PipelineMatrixComponent,
    SwimLaneLayoutComponent,
    WorkflowRowsLayoutComponent,
    HistoryDrawerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dd-header (correlationPickChanged)="onCorrelationPickChanged($event)"></dd-header>
    <dd-stats-bar></dd-stats-bar>
    @switch (store.layout()) {
      @case ('matrix') {
        <dd-pipeline-matrix (openSlot)="onOpenSlot($event)"></dd-pipeline-matrix>
      }
      @case ('swim-lane') {
        <dd-swim-lane-layout (openSlot)="onOpenSlot($event)"></dd-swim-lane-layout>
      }
      @case ('workflow-rows') {
        <dd-workflow-rows-layout (openSlot)="onOpenSlot($event)"></dd-workflow-rows-layout>
      }
    }
    <dd-history-drawer></dd-history-drawer>
  `
})
export class AppComponent implements OnInit {
  readonly store = inject(DeploymentMatrixStore);
  private readonly api = inject(ApiClientService);
  private readonly sse = inject(SseService);
  private readonly hostEl: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Coalesced follow-up GET timer per SAD §7 "SSE topology semantics". */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.bootstrap();
    this.wireSse();
    this.destroyRef.onDestroy(() => {
      if (this.refreshTimer !== null) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
    });
  }

  /**
   * Pulls services, environments, matrix, topology, and the topology
   * correlation config from the Read API. Falls back to canonical fixture
   * data so the SPA renders something useful during local dev before the
   * backend is wired up.
   */
  private bootstrap(): void {
    this.api.environments().subscribe({
      next: envs => this.store.setEnvironments(envs.length ? envs : FIXTURE_ENVIRONMENTS),
      error: () => this.store.setEnvironments(FIXTURE_ENVIRONMENTS)
    });
    this.api.services().subscribe({
      next: svcs => this.store.setServices(svcs.length ? svcs : FIXTURE_SERVICES),
      error: () => this.store.setServices(FIXTURE_SERVICES)
    });
    this.fetchMatrix(/* fallbackToFixtures */ true);
    this.api.topologyConfig().subscribe({
      next: cfg => this.store.setTopologyConfig(cfg),
      error: () => this.store.setTopologyConfig({ ...FIXTURE_TOPOLOGY_CONFIG })
    });
  }

  private wireSse(): void {
    this.sse.slotUpdates$.subscribe(p => this.onSlotUpdate(p));
    // On reconnect, re-pull the full matrix once via REST to recover any
    // events that may have been missed during the disconnected window.
    this.sse.reconnected$.subscribe(() => this.fetchMatrix(false));
    this.sse.connect();
  }

  /**
   * SSE slot-update handler. Patches the store immediately (no waiting on
   * a round trip for status/version/actor), then schedules a coalesced
   * GET for the topology refresh. Also applies the focus-on-last-event
   * scroll + pulse on the next animation frame.
   */
  private onSlotUpdate(payload: SlotUpdatePayload): void {
    this.store.slotUpdated(payload);
    this.scheduleMatrixRefresh();
    requestAnimationFrame(() =>
      this.applyFocusOrInPlace(this.findEventTarget(payload))
    );
  }

  /**
   * Schedule a follow-up matrix GET, coalescing bursts. Multiple SSE
   * events landing inside a 250 ms window result in one GET per SAD §7
   * "SSE topology semantics".
   */
  private scheduleMatrixRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.fetchMatrix(false);
    }, REFRESH_COALESCE_MS);
  }

  /**
   * One matrix GET — replaces both `matrix` and `topology` wholesale from
   * the response. `correlationAttribute` falls back to fixture data only
   * on initial bootstrap; subsequent failures keep the prior store state.
   */
  private fetchMatrix(fallbackToFixtures: boolean): void {
    this.api.matrix(this.store.correlationAttribute()).subscribe({
      next: payload => {
        this.store.setMatrix(payload.matrix);
        this.store.setTopology(payload.topology);
      },
      error: () => {
        if (!fallbackToFixtures) return;
        this.store.setMatrix(FIXTURE_MATRIX);
        this.store.setTopology(FIXTURE_TOPOLOGY);
      }
    });
  }

  /** Picker change → refresh matrix immediately with the new query parameter. */
  onCorrelationPickChanged(_value: CorrelationAttribute | undefined): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.fetchMatrix(false);
  }

  onOpenSlot(payload: { service: ServiceDescriptor; env: EnvironmentDescriptor }): void {
    this.store.openDrawer(payload.service, payload.env);
  }

  // ---- Focus on last event (mockup applyFocusOrInPlace) ---------------------

  /**
   * Resolve the DOM element that the latest event affected. Layout-specific:
   *  - matrix / swim-lane / workflow-rows row level → use the `[data-testid="stage-box-..."]`
   *    element so the highlight lands on the actual box (or its row).
   */
  private findEventTarget(payload: SlotUpdatePayload): HTMLElement | null {
    const host = this.hostEl?.nativeElement;
    if (!host) return null;
    return host.querySelector<HTMLElement>(
      `[data-testid="stage-box-${payload.service}-${payload.environment}"]`
    );
  }

  /**
   * Mockup applyFocusOrInPlace port (docs/ui/deployment-dashboard.html
   * lines 2386–2407). When `focusOnLastEvent === true`, scroll the
   * affected element into view and apply the 900 ms `swap-pulse` class;
   * when `false`, only pulse if the element is already in the viewport.
   */
  private applyFocusOrInPlace(element: HTMLElement | null): void {
    if (!element) return;
    const focusOn = this.store.focusOnLastEvent();
    if (focusOn) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.pulse(element);
      return;
    }
    const r = element.getBoundingClientRect();
    const inView =
      r.bottom > 0 && r.top < window.innerHeight &&
      r.right  > 0 && r.left < window.innerWidth;
    if (!inView) return;
    this.pulse(element);
  }

  private pulse(element: HTMLElement): void {
    element.classList.add('swap-pulse');
    setTimeout(() => element.classList.remove('swap-pulse'), PULSE_MS + 100);
  }
}
