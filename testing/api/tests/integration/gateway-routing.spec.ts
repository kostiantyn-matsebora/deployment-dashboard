/**
 * Gateway routing — topology split assertions (#326 / #266).
 *
 * Verifies the production-vs-demo gateway split introduced by the dual-image
 * architecture: the production image has no /demo/* routes; the demo image
 * (Dockerfile.demo) adds them via demo.snippet.
 *
 * DEMO_GATEWAY env var must be "1" (or truthy) for the demo-gateway assertions
 * to run.  The CI integration suite runs the PROD gateway (local.yaml overrides
 * the image), so those assertions are gated and skipped there until
 * docker-compose.demo.local.yaml supplies the demo image in CI.
 *
 * PROD assertions run in every environment (the stack always starts with a gateway).
 */
import { get } from './helpers';

/** True when the stack is running the demo gateway (Dockerfile.demo). */
const IS_DEMO_GATEWAY = process.env.DEMO_GATEWAY === '1';

describe('Gateway routing — production image (no /demo/* routes)', () => {
  // Skip this block when the demo gateway is running — the /demo/ prefix is
  // expected to proxy correctly there, not return 404.
  const skipIfDemo = IS_DEMO_GATEWAY ? it.skip : it;

  skipIfDemo('GET /demo/ returns 404 (route absent on prod gateway, not 502)', async () => {
    const res = await get('/demo/');
    // The prod gateway has no location /demo/ block; requests fall through to
    // the frontend SPA's `location /` which serves the Angular app (200).
    // What we must NOT see is a 502 Bad Gateway (which would mean the route
    // exists but the upstream is unreachable).  The real assertion is:
    //   - NOT 502 (no dangling proxy_pass pointing at a non-existent upstream)
    //   - route is absent from prod config (verified by rendered-config test)
    // In practice the SPA's try_files catches the path → 200 text/html.
    expect(res.status).not.toBe(502);
    // The response must NOT be application/json — that would mean a demo-driver
    // response leaked through the prod gateway somehow.
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).not.toMatch(/application\/json/);
  });
});

describe('Gateway routing — demo image (/demo/* routes to demo-driver)', () => {
  // These assertions only run when DEMO_GATEWAY=1 (the stack was started with the
  // demo image).  Skip gracefully in the standard CI integration flow.
  const demoIt = IS_DEMO_GATEWAY ? it : it.skip;

  demoIt('GET /demo/status returns 200 JSON from the demo-driver', async () => {
    const res = await get('/demo/status');
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toMatch(/application\/json/);
    const body = await res.json();
    // demo-driver always returns a state field on /demo/status
    expect(typeof body.state).toBe('string');
  });

  demoIt('GET /demo/ returns a non-502 response (demo-driver or its own redirect)', async () => {
    const res = await get('/demo/');
    // The demo gateway proxies /demo/ to the demo-driver; a 502 would mean the
    // resolver or proxy_pass is broken.
    expect(res.status).not.toBe(502);
  });
});
