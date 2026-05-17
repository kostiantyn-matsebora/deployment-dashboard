// Smoke test — the root component boots without exploding when API calls
// fail and fixture fallback kicks in.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AppComponent } from './app.component';
import { ApiClientService, SseService } from '@dd/shared';

describe('AppComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: HttpClient, useValue: { get: () => of([]) } },
        {
          provide: ApiClientService,
          useValue: {
            environments: () => throwError(() => new Error('offline')),
            services: () => throwError(() => new Error('offline')),
            // The API client's `matrix(correlationAttribute?)` accepts an
            // optional argument; the stub ignores it.
            matrix: () => throwError(() => new Error('offline')),
            history: () => of([]),
            topologyConfig: () => throwError(() => new Error('offline'))
          }
        },
        {
          provide: SseService,
          useValue: {
            slotUpdates$: { subscribe: () => ({ unsubscribe() {} }) },
            reconnected$: { subscribe: () => ({ unsubscribe() {} }) },
            opened$: { subscribe: () => ({ unsubscribe() {} }) },
            connect: () => {}
          }
        }
      ]
    });
  });

  it('boots and renders the header + default Swim-lane layout body', () => {
    // Matrix deferred to Phase 2.0 — MVP defaults to Swim-lane (mockup
    // `docs/ui/deployment-dashboard.html` line 2841).
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('dd-header')).not.toBeNull();
    expect(host.querySelector('dd-swim-lane-layout')).not.toBeNull();
    expect(host.querySelector('dd-pipeline-matrix')).toBeNull();
    expect(host.querySelector('[data-testid="live-indicator"]')?.textContent).toContain('Live');
    // FR-13 — the layout switcher renders in the header.
    expect(host.querySelector('[data-testid="layout-switcher"]')).not.toBeNull();
    // Mockup header toggle for the focus-on-last-event signal.
    expect(host.querySelector('[data-testid="focus-on-last-event-toggle"]')).not.toBeNull();
  });
});
