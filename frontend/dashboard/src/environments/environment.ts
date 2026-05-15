// Default (production) environment configuration.
//
// SAD §5 NFR-04 + §10 Decision #7 — the SPA is READ-ONLY against the API
// and never carries the `X-Api-Key`. PATCH /api/config/topology is admin /
// CI / ops only; the SPA expresses user picker preferences via
// `dashboard.correlationAttribute` in localStorage and appends them as a
// `correlationAttribute` query parameter on read endpoints. No API key
// lives in this file or the built SPA bundle.

export const environment = {
  /** Compile-time mode flag. */
  production: true
};
