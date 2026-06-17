/**
 * FooterComponent — unit tests.
 *
 * Covers:
 *   - version chip hidden while loading (initial '…' value)
 *   - version chip renders verbatim — no 'v' added by the component
 *   - falls back to '0.0.0-dev' (not 'v0.0.0-dev') when GET /api/version errors
 *   - Documentation link href resolves to the docs URL
 *   - Author link href resolves to the GitHub profile URL
 *   - MIT License link href resolves to the LICENSE URL
 *
 * Strategy: provide a controlled DeploymentApiService stub whose getVersion()
 * returns a synchronous observable (of() / throwError()) so all assertions
 * run synchronously — the same pattern used by analytics.component.spec.ts.
 * No zone-testing primitives (fakeAsync/tick) are needed.
 */
import { ComponentFixture, TestBed }   from '@angular/core/testing';
import { provideHttpClient }           from '@angular/common/http';
import { provideHttpClientTesting }    from '@angular/common/http/testing';
import { Observable, of, throwError }  from 'rxjs';

import { FooterComponent }             from './footer.component';
import { DeploymentApiService }        from '../../core/services/deployment-api.service';

// ── stub factory ─────────────────────────────────────────────────────────────

function mkApi(version: string | 'error'): Partial<DeploymentApiService> {
  return {
    getVersion: () =>
      version === 'error'
        ? throwError(() => new Error('network error'))
        : of({ version }),
  };
}

// ── shared TestBed builder ────────────────────────────────────────────────────

async function buildFixture(
  apiStub: Partial<DeploymentApiService>,
): Promise<ComponentFixture<FooterComponent>> {
  await TestBed.configureTestingModule({
    imports:   [FooterComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: DeploymentApiService, useValue: apiStub },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FooterComponent);
  fixture.detectChanges();   // triggers ngOnInit; getVersion() emits synchronously
  return fixture;
}

// ── suite ────────────────────────────────────────────────────────────────────

describe('FooterComponent', () => {

  afterEach(() => TestBed.resetTestingModule());

  // ── version chip — loading placeholder ─────────────────────────────────────

  describe('version signal — loading placeholder', () => {
    it('initial version signal value is "…" before getVersion emits', async () => {
      // Build without calling detectChanges — ngOnInit has NOT yet run.
      await TestBed.configureTestingModule({
        imports:   [FooterComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: DeploymentApiService, useValue: mkApi('v0.13.1') },
        ],
      }).compileComponents();

      const fixture  = TestBed.createComponent(FooterComponent);
      const component = fixture.componentInstance;

      // Read the protected signal BEFORE change detection (before ngOnInit fires).
      const ver = (component as unknown as Record<string, () => string>)['version'];
      expect(ver()).toBe('…');

      // Trigger ngOnInit (synchronous emit updates the signal).
      fixture.detectChanges();
      expect(ver()).toBe('v0.13.1');
    });

    it('chip is absent in the DOM while version signal is "…"', async () => {
      // Provide an observable that never emits so the signal stays at '…'.
      const neverApi: Partial<DeploymentApiService> = {
        getVersion: () => new Observable<{ version: string }>(() => { /* never emits */ }),
      };

      await TestBed.configureTestingModule({
        imports:   [FooterComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: DeploymentApiService, useValue: neverApi },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(FooterComponent);
      fixture.detectChanges();

      const chip = fixture.nativeElement.querySelector('.brand-ver-chip');
      expect(chip).toBeNull();
    });
  });

  // ── version chip — happy path ───────────────────────────────────────────────

  describe('version chip — successful fetch', () => {
    it('renders version string verbatim (release form) after a successful getVersion response', async () => {
      const fixture = await buildFixture(mkApi('v0.13.1'));

      const chip: HTMLElement | null = fixture.nativeElement.querySelector('.brand-ver-chip');
      expect(chip).not.toBeNull();
      expect(chip!.textContent!.trim()).toBe('v0.13.1');
    });

    it('renders version string verbatim (CI/main build form)', async () => {
      const fixture = await buildFixture(mkApi('main+abc1234'));

      const chip: HTMLElement | null = fixture.nativeElement.querySelector('.brand-ver-chip');
      expect(chip).not.toBeNull();
      expect(chip!.textContent!.trim()).toBe('main+abc1234');
    });

    it('version signal is set to the API-returned value verbatim', async () => {
      const fixture   = await buildFixture(mkApi('v1.2.3'));
      const component = fixture.componentInstance;

      const ver = (component as unknown as Record<string, () => string>)['version'];
      expect(ver()).toBe('v1.2.3');
    });
  });

  // ── version chip — error path ───────────────────────────────────────────────

  describe('version chip — failed fetch', () => {
    it('version signal falls back to "0.0.0-dev" on a getVersion error', async () => {
      const fixture   = await buildFixture(mkApi('error'));
      const component = fixture.componentInstance;

      const ver = (component as unknown as Record<string, () => string>)['version'];
      expect(ver()).toBe('0.0.0-dev');
    });

    it('chip renders verbatim fallback "0.0.0-dev" (no added "v") after a fetch error', async () => {
      const fixture = await buildFixture(mkApi('error'));
      fixture.detectChanges();

      const chip: HTMLElement | null = fixture.nativeElement.querySelector('.brand-ver-chip');
      expect(chip).not.toBeNull();
      expect(chip!.textContent!.trim()).toBe('0.0.0-dev');
    });
  });

  // ── link URLs ──────────────────────────────────────────────────────────────

  describe('link hrefs', () => {
    let fixture: ComponentFixture<FooterComponent>;

    beforeEach(async () => {
      fixture = await buildFixture(mkApi('v0.13.1'));
    });

    it('Documentation link resolves to the adopter docs site URL', () => {
      const links: NodeListOf<HTMLAnchorElement> =
        fixture.nativeElement.querySelectorAll('a');
      const docsLink = Array.from(links).find(a => a.textContent?.trim() === 'Documentation');
      expect(docsLink).toBeDefined();
      expect(docsLink!.href).toBe(
        'https://kostiantyn-matsebora.github.io/deployment-dashboard/',
      );
    });

    it('@kostiantyn-matsebora link resolves to the GitHub profile URL', () => {
      const links: NodeListOf<HTMLAnchorElement> =
        fixture.nativeElement.querySelectorAll('a');
      const authorLink = Array.from(links).find(
        a => a.textContent?.includes('@kostiantyn-matsebora'),
      );
      expect(authorLink).toBeDefined();
      expect(authorLink!.href).toBe('https://github.com/kostiantyn-matsebora');
    });

    it('MIT License link resolves to the LICENSE file URL', () => {
      const links: NodeListOf<HTMLAnchorElement> =
        fixture.nativeElement.querySelectorAll('a');
      const licenseLink = Array.from(links).find(
        a => a.textContent?.trim() === 'MIT License',
      );
      expect(licenseLink).toBeDefined();
      expect(licenseLink!.href).toBe(
        'https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/LICENSE',
      );
    });
  });

});
