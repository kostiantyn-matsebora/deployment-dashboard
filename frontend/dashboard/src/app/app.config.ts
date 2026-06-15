import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';

/**
 * Application-level providers.
 * PrimeNG configured in unstyled mode — all styling via design tokens.
 * ECharts (ngx-echarts) is provided at the AnalyticsComponent level so that
 * the echarts library stays in the lazy analytics chunk and does NOT inflate the
 * initial bundle. provideEchartsCore is declared in analytics.component.ts.
 * Spec: docs/design/libraries.md §PrimeNG Unstyled Mode — Configuration
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    provideAnimationsAsync(),
    providePrimeNG({ unstyled: true }),
  ],
};
