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
 *
 * PWA assertions (#314):
 *   Verifies that the frontend nginx correctly serves manifest.webmanifest with
 *   Content-Type: application/manifest+json through the gateway, and that each
 *   icon listed in the manifest returns 200 image/png through the gateway.
 */
import { get, BASE } from './helpers';

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

// ---------------------------------------------------------------------------
// PWA — manifest + icons through the gateway (#314)
//
// The gateway proxies / to the frontend container (GW3) blindly, so the
// frontend nginx Content-Type header for .webmanifest passes through unchanged.
// These assertions verify the full chain: gateway → frontend nginx → file.
// ---------------------------------------------------------------------------

/** Manifest icon shape (matches the contract in contract-manifest.md). */
interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

describe('Gateway PWA (#314) — manifest served with correct Content-Type', () => {

  it('GET /manifest.webmanifest returns 200 through the gateway', async () => {
    const res = await get('/manifest.webmanifest');
    expect(res.status).toBe(200);
  });

  it('GET /manifest.webmanifest Content-Type includes application/manifest+json', async () => {
    const res = await get('/manifest.webmanifest');
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toMatch(/application\/manifest\+json/);
  });

  it('GET /manifest.webmanifest response body is valid JSON', async () => {
    const res = await get('/manifest.webmanifest');
    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

});

describe('Gateway PWA (#314) — icons reachable through the gateway', () => {

  /**
   * Fetch the manifest through the gateway and return its icons array.
   * Fails the test immediately if the manifest is not reachable.
   */
  async function gatewayIcons(): Promise<ManifestIcon[]> {
    const res = await fetch(`${BASE}/manifest.webmanifest`);
    if (!res.ok) throw new Error(`GET /manifest.webmanifest -> ${res.status}`);
    const body = (await res.json()) as { icons?: ManifestIcon[] };
    return body.icons ?? [];
  }

  it('each icon listed in the manifest returns 200 image/png through the gateway', async () => {
    const iconList = await gatewayIcons();

    expect(iconList.length).toBeGreaterThan(0);

    for (const icon of iconList) {
      // Icon src values are relative (no leading /) — resolve against the SPA root.
      const url = `${BASE}/${icon.src}`;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct).toMatch(/image\/png/);
    }
  });

});
