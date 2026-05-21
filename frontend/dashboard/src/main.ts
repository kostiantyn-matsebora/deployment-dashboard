import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import {
  inject,
  provideEnvironmentInitializer,
  provideZonelessChangeDetection
} from '@angular/core';
import {
  CorrelationPrefsService,
  FetcherUsageStore,
  FocusOnLastEventPrefsService,
  LayoutPrefsService,
  ThemeService,
  ViewPrefsService
} from '@dd/shared';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    // FR-12 — eagerly instantiate the view-prefs service at bootstrap so it
    // can hydrate the store from localStorage and start syncing changes
    // back. The service is `providedIn: 'root'` but Angular only creates
    // root-scoped injectables on first injection — this initializer makes
    // sure that happens before the dashboard renders.
    provideEnvironmentInitializer(() => inject(ViewPrefsService)),
    // FR-13 — same trick for the layout-prefs service.
    provideEnvironmentInitializer(() => inject(LayoutPrefsService)),
    // SAD §10 Decision #7 — the correlation-attribute pick must be loaded
    // into the store BEFORE the first matrix GET fires, otherwise the
    // initial request omits the query parameter.
    provideEnvironmentInitializer(() => inject(CorrelationPrefsService)),
    // Mockup header toggle — load the persisted state before SSE wires up.
    provideEnvironmentInitializer(() => inject(FocusOnLastEventPrefsService)),
    // Theme axis — eagerly construct so the live MQL listener attaches
    // and the single-writer effect on `documentElement.dataset.theme`
    // starts before the first user interaction. The FOIT-safe inline
    // <head> script in index.html paints the first frame; this service
    // takes over thereafter.
    provideEnvironmentInitializer(() => inject(ThemeService)),
    // CR-0011 § 3d / D5 — start polling `GET /api/fetcher/usage` so the
    // rate-limit cluster has data on first paint. The store is
    // `providedIn: 'root'`; `start()` is idempotent. Polling continues for
    // the lifetime of the SPA; the store stops itself on root-injector
    // teardown (test seam).
    provideEnvironmentInitializer(() => inject(FetcherUsageStore).start())
  ]
}).catch(err => console.error(err));
