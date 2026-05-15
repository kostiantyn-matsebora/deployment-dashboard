// Local-dev environment configuration. Activated by Angular's
// `fileReplacements` for the `development` build (see angular.json).
//
// SAD §5 NFR-04 + §10 Decision #7 — the SPA is read-only. No API key
// lives in the SPA bundle in any configuration. PATCH /api/config/topology
// is admin / CI / ops only (testing/scripts) and uses its own credentials.

export const environment = {
  production: false
};
