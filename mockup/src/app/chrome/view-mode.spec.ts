// Specs for pass-4 + pass-5 additions:
//   1. View-mode switcher buttons exist and drive ViewModeService signal.
//   2. Display / Topology / Settings popover buttons exist and open their panels.
//   3. SwimLaneLayoutComponent renders Glance pills in glance mode.
//   4. WorkflowRowsLayoutComponent renders Glance pills in glance mode.
//   5. LayoutLeafComponent renders compact box in compact mode.
//   6. (pass-5) SwimLaneLayoutComponent Focus chrome: helper bar + chevron + pin per service.
//   7. (pass-5) SwimLaneLayoutComponent Detailed mode: arrow-gap connectors present.
//   8. (pass-5) WorkflowRowsLayoutComponent Focus chrome: helper bar + 3 controls + expand-all.
//   9. (pass-5) Dark theme: selecting Dark radio sets data-theme="dark" on documentElement.
//  10. (pass-5) Fixtures: recovered state present (success + previousFailed: true).

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from '../app.component';
import { ViewModeService } from '../view-mode.service';
import { SwimLaneLayoutComponent } from './swim-lane-layout.component';
import { WorkflowRowsLayoutComponent } from './workflow-rows-layout.component';
import { LayoutLeafComponent } from './layout-leaf.component';
import {
  MOCKUP_SERVICES,
  MOCKUP_ENVIRONMENTS,
  MOCKUP_MATRIX,
  MOCKUP_TOPOLOGY
} from '../fixtures/index';

// ── AppComponent: view-switcher + popovers ─────────────────────────────────

describe('AppComponent — view-switcher + popovers', () => {
  let fixture: ComponentFixture<AppComponent>;
  let el: HTMLElement;
  let viewMode: ViewModeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    viewMode = TestBed.inject(ViewModeService);
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render the view-switcher with four options', () => {
    expect(el.querySelector('[data-testid="view-option-detailed"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="view-option-compact"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="view-option-glance"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="view-option-focus"]')).toBeTruthy();
  });

  it('should start with Detailed as active', () => {
    const btn = el.querySelector('[data-testid="view-option-detailed"]') as HTMLElement;
    expect(btn.getAttribute('data-active')).toBe('true');
    expect(viewMode.mode()).toBe('detailed');
  });

  it('should update ViewModeService when Compact is clicked', () => {
    const btn = el.querySelector('[data-testid="view-option-compact"]') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(viewMode.mode()).toBe('compact');
    expect(btn.getAttribute('data-active')).toBe('true');
  });

  it('should update ViewModeService when Glance is clicked', () => {
    const btn = el.querySelector('[data-testid="view-option-glance"]') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(viewMode.mode()).toBe('glance');
  });

  it('should update ViewModeService when Focus is clicked', () => {
    const btn = el.querySelector('[data-testid="view-option-focus"]') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(viewMode.mode()).toBe('focus');
  });

  it('should render the Display trigger button', () => {
    expect(el.querySelector('[data-testid="attribute-picker"]')).toBeTruthy();
  });

  it('should open Display popover on click', () => {
    const trigger = el.querySelector('[data-testid="attribute-picker"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="display-popover"]')).toBeTruthy();
  });

  it('Display popover should list Status badge item', () => {
    const trigger = el.querySelector('[data-testid="attribute-picker"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const item = el.querySelector('[data-testid="display-item-status-badge"]');
    expect(item).toBeTruthy();
  });

  it('should render the Topology trigger button', () => {
    expect(el.querySelector('[data-testid="topology-picker"]')).toBeTruthy();
  });

  it('should open Topology popover on click', () => {
    const trigger = el.querySelector('[data-testid="topology-picker"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="topology-popover"]')).toBeTruthy();
  });

  it('Topology popover should list Versions mode', () => {
    const trigger = el.querySelector('[data-testid="topology-picker"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="topology-mode-versions"]')).toBeTruthy();
  });

  it('should render the Settings gear button', () => {
    expect(el.querySelector('[data-testid="theme-switcher"]')).toBeTruthy();
  });

  it('should open Settings popover on click', () => {
    const trigger = el.querySelector('[data-testid="theme-switcher"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="settings-popover"]')).toBeTruthy();
  });

  it('Settings popover should have Light / Dark / Auto options', () => {
    const trigger = el.querySelector('[data-testid="theme-switcher"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="theme-option-light"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="theme-option-dark"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="theme-option-auto"]')).toBeTruthy();
  });

  it('should close Display popover when clicking the same trigger again', () => {
    const trigger = el.querySelector('[data-testid="attribute-picker"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="display-popover"]')).toBeTruthy();
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="display-popover"]')).toBeNull();
  });
});

// ── SwimLaneLayoutComponent: glance pill rendering ─────────────────────────

describe('SwimLaneLayoutComponent — glance view', () => {
  let fixture: ComponentFixture<SwimLaneLayoutComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwimLaneLayoutComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SwimLaneLayoutComponent);
    const comp = fixture.componentInstance;
    comp.services = MOCKUP_SERVICES;
    comp.environments = MOCKUP_ENVIRONMENTS;
    comp.matrix = MOCKUP_MATRIX;
    comp.topology = MOCKUP_TOPOLOGY;
    comp.viewMode = 'glance';
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render glance data-view attribute', () => {
    expect(el.querySelector('[data-view="glance"]')).toBeTruthy();
  });

  it('should render one glance row per service', () => {
    const rows = el.querySelectorAll('[data-testid^="swim-lane-row-"]');
    expect(rows.length).toBe(MOCKUP_SERVICES.length);
  });

  it('should render glance pills for service-a', () => {
    const pills = el.querySelectorAll('[data-testid^="glance-pill-service-a-"]');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('should NOT render stage-box elements in glance mode', () => {
    const boxes = el.querySelectorAll('[data-testid^="stage-box-"]');
    expect(boxes.length).toBe(0);
  });
});

// ── SwimLaneLayoutComponent: compact density ───────────────────────────────

describe('SwimLaneLayoutComponent — compact view', () => {
  let fixture: ComponentFixture<SwimLaneLayoutComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwimLaneLayoutComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SwimLaneLayoutComponent);
    const comp = fixture.componentInstance;
    comp.services = MOCKUP_SERVICES;
    comp.environments = MOCKUP_ENVIRONMENTS;
    comp.matrix = MOCKUP_MATRIX;
    comp.topology = MOCKUP_TOPOLOGY;
    comp.viewMode = 'compact';
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render compact data-view attribute', () => {
    expect(el.querySelector('[data-view="compact"]')).toBeTruthy();
  });

  it('should render compact-box elements (not stage-box detailed)', () => {
    const boxes = el.querySelectorAll('[data-view="compact"]');
    expect(boxes.length).toBeGreaterThan(0);
  });

  it('should NOT render glance pills in compact mode', () => {
    const pills = el.querySelectorAll('[data-testid^="glance-pill-"]');
    expect(pills.length).toBe(0);
  });
});

// ── WorkflowRowsLayoutComponent: glance view ──────────────────────────────

describe('WorkflowRowsLayoutComponent — glance view', () => {
  let fixture: ComponentFixture<WorkflowRowsLayoutComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowRowsLayoutComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowRowsLayoutComponent);
    const comp = fixture.componentInstance;
    comp.services = MOCKUP_SERVICES;
    comp.environments = MOCKUP_ENVIRONMENTS;
    comp.matrix = MOCKUP_MATRIX;
    comp.topology = MOCKUP_TOPOLOGY;
    comp.viewMode = 'glance';
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render glance data-view attribute', () => {
    expect(el.querySelector('[data-view="glance"]')).toBeTruthy();
  });

  it('should render glance pills for service-b', () => {
    const pills = el.querySelectorAll('[data-testid^="glance-pill-service-b-"]');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('should NOT render stage-box elements in glance mode', () => {
    const boxes = el.querySelectorAll('[data-testid^="stage-box-"]');
    expect(boxes.length).toBe(0);
  });
});

// ── LayoutLeafComponent: compact box rendering ────────────────────────────

describe('LayoutLeafComponent — compact view', () => {
  let fixture: ComponentFixture<LayoutLeafComponent>;
  let el: HTMLElement;

  const svc = MOCKUP_SERVICES[0];
  const env = MOCKUP_ENVIRONMENTS[0];
  const slot = MOCKUP_MATRIX['service-a']['dev']!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LayoutLeafComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(LayoutLeafComponent);
    const comp = fixture.componentInstance;
    comp.service = svc;
    comp.env = env;
    comp.slot = slot;
    comp.viewMode = 'compact';
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render compact data-view attribute', () => {
    expect(el.querySelector('[data-view="compact"]')).toBeTruthy();
  });

  it('should render the commit hash in compact mode', () => {
    const hashEl = el.querySelector('[data-testid^="current-version-"]');
    expect(hashEl).toBeTruthy();
    // hash text should be 7 chars (a fragment of sha or derived hex)
    expect(hashEl!.textContent!.trim().length).toBe(7);
  });

  it('should render age in compact mode', () => {
    const ageEl = el.querySelector('[data-testid^="current-ago-"]');
    expect(ageEl).toBeTruthy();
  });

  it('should render actor in compact mode', () => {
    const actorEl = el.querySelector('[data-testid^="current-actor-"]');
    expect(actorEl).toBeTruthy();
  });

  it('should NOT render dd-mockup-stage-box in compact mode', () => {
    const box = el.querySelector('dd-mockup-stage-box');
    expect(box).toBeNull();
  });
});

// ── SwimLaneLayoutComponent: Focus chrome ─────────────────────────────────

describe('SwimLaneLayoutComponent — focus view chrome', () => {
  let fixture: ComponentFixture<SwimLaneLayoutComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwimLaneLayoutComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SwimLaneLayoutComponent);
    const comp = fixture.componentInstance;
    comp.services = MOCKUP_SERVICES;
    comp.environments = MOCKUP_ENVIRONMENTS;
    comp.matrix = MOCKUP_MATRIX;
    comp.topology = MOCKUP_TOPOLOGY;
    comp.viewMode = 'focus';
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render focus data-view attribute', () => {
    expect(el.querySelector('[data-view="focus"]')).toBeTruthy();
  });

  it('should render the focus helper text bar', () => {
    expect(el.querySelector('[data-testid="focus-helper-bar"]')).toBeTruthy();
  });

  it('should render a chevron button per service', () => {
    const chevrons = el.querySelectorAll('[data-testid^="focus-chevron-"]');
    expect(chevrons.length).toBe(MOCKUP_SERVICES.length);
  });

  it('should render a pin button per service', () => {
    const pins = el.querySelectorAll('[data-testid^="focus-pin-"]');
    expect(pins.length).toBe(MOCKUP_SERVICES.length);
  });

  it('should start with all services collapsed (data-expanded=false)', () => {
    const rows = el.querySelectorAll('[data-testid^="swim-lane-row-"]');
    rows.forEach(row => {
      expect(row.getAttribute('data-expanded')).toBe('false');
    });
  });

  it('should expand a service row when its chevron is clicked', () => {
    const svcId = MOCKUP_SERVICES[0].id;
    const chevron = el.querySelector(`[data-testid="focus-chevron-${svcId}"]`) as HTMLButtonElement;
    chevron.click();
    fixture.detectChanges();
    const row = el.querySelector(`[data-testid="swim-lane-row-${svcId}"]`);
    expect(row?.getAttribute('data-expanded')).toBe('true');
  });

  it('should toggle pin state when pin button is clicked', () => {
    const svcId = MOCKUP_SERVICES[0].id;
    const pin = el.querySelector(`[data-testid="focus-pin-${svcId}"]`) as HTMLButtonElement;
    expect(pin?.getAttribute('aria-pressed')).toBe('false');
    pin.click();
    fixture.detectChanges();
    expect(pin?.getAttribute('aria-pressed')).toBe('true');
  });
});

// ── SwimLaneLayoutComponent: connector arrows in detailed mode ─────────────

describe('SwimLaneLayoutComponent — detailed view arrow connectors', () => {
  let fixture: ComponentFixture<SwimLaneLayoutComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwimLaneLayoutComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SwimLaneLayoutComponent);
    const comp = fixture.componentInstance;
    comp.services = MOCKUP_SERVICES;
    comp.environments = MOCKUP_ENVIRONMENTS;
    comp.matrix = MOCKUP_MATRIX;
    comp.topology = MOCKUP_TOPOLOGY;
    comp.viewMode = 'detailed';
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render arrow-gap connector elements between depth columns', () => {
    const gaps = el.querySelectorAll('.arrow-gap');
    expect(gaps.length).toBeGreaterThan(0);
  });
});

// ── WorkflowRowsLayoutComponent: Focus chrome ────────────────────────────

describe('WorkflowRowsLayoutComponent — focus view chrome', () => {
  let fixture: ComponentFixture<WorkflowRowsLayoutComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowRowsLayoutComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowRowsLayoutComponent);
    const comp = fixture.componentInstance;
    comp.services = MOCKUP_SERVICES;
    comp.environments = MOCKUP_ENVIRONMENTS;
    comp.matrix = MOCKUP_MATRIX;
    comp.topology = MOCKUP_TOPOLOGY;
    comp.viewMode = 'focus';
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should render focus data-view attribute', () => {
    expect(el.querySelector('[data-view="focus"]')).toBeTruthy();
  });

  it('should render the focus helper text bar', () => {
    expect(el.querySelector('[data-testid="focus-helper-bar"]')).toBeTruthy();
  });

  it('should render the "Expand all workflows" button', () => {
    expect(el.querySelector('[data-testid="expand-all-workflows"]')).toBeTruthy();
  });

  it('should render a wf-chevron per service', () => {
    const chevrons = el.querySelectorAll('[data-testid^="focus-wf-chevron-"]');
    expect(chevrons.length).toBe(MOCKUP_SERVICES.length);
  });

  it('should render a pin per service', () => {
    const pins = el.querySelectorAll('[data-testid^="focus-pin-"]');
    expect(pins.length).toBe(MOCKUP_SERVICES.length);
  });

  it('should render a detail-chevron per service', () => {
    const chevrons = el.querySelectorAll('[data-testid^="focus-detail-chevron-"]');
    expect(chevrons.length).toBe(MOCKUP_SERVICES.length);
  });

  it('should expand workflow rows when wf-chevron is clicked', () => {
    const svcId = MOCKUP_SERVICES[0].id;
    const chevron = el.querySelector(`[data-testid="focus-wf-chevron-${svcId}"]`) as HTMLButtonElement;
    chevron.click();
    fixture.detectChanges();
    const wfRow = el.querySelector(`[data-testid="workflow-row-${svcId}-0"]`);
    expect(wfRow).toBeTruthy();
  });

  it('should expand all workflows when "Expand all" is clicked', () => {
    const btn = el.querySelector('[data-testid="expand-all-workflows"]') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    // All services should now have wfExpanded = true, so workflow-row-*-0 should be present for each
    for (const svc of MOCKUP_SERVICES) {
      const wfRow = el.querySelector(`[data-testid="workflow-row-${svc.id}-0"]`);
      expect(wfRow).toBeTruthy(`expected workflow-row for ${svc.id} to be present`);
    }
  });
});

// ── Dark theme: Settings radio wires to document.documentElement ──────────

describe('AppComponent — dark theme wiring', () => {
  let fixture: ComponentFixture<AppComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    // Remove any lingering data-theme from prior tests
    document.documentElement.removeAttribute('data-theme');

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  afterEach(() => {
    // Clean up so subsequent test suites start with no theme override
    document.documentElement.removeAttribute('data-theme');
  });

  it('should not set data-theme on documentElement by default (Light)', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('should set data-theme="dark" when Dark radio is selected', () => {
    const comp = fixture.componentInstance;
    comp.selectedTheme = 'dark';
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('should remove data-theme when Light radio is selected after Dark', () => {
    const comp = fixture.componentInstance;
    comp.selectedTheme = 'dark';
    fixture.detectChanges();
    comp.selectedTheme = 'light';
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});

// ── Fixtures: recovered state (success + previousFailed: true) ────────────

describe('Fixtures — recovered state present', () => {
  it('should have at least one slot with success status and previousFailed=true', () => {
    let found = false;
    for (const service of Object.values(MOCKUP_MATRIX)) {
      for (const slot of Object.values(service)) {
        if (slot && slot.current.status === 'success' && slot.previousFailed === true) {
          found = true;
        }
      }
    }
    expect(found).toBeTrue();
  });
});
