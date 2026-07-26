import { Controller, Get } from '@nestjs/common';

/**
 * Mock provided-presets controller — GET /api/presets (issue #391).
 * Spec: docs/api/openapi.yaml — tag: presets, schema: ProvidedPresets.
 *
 * Serves a fixed, realistic merged catalog from at least two sources so the
 * SPA's topbar "PROVIDED" section (read-only, "provided by {source}"
 * attribution, Apply + Clone-to-edit only) has data to render in dev + E2E.
 * Zero-setup dev: the fixture is always returned regardless of query params;
 * there is no corresponding PUT /api/presets/sources/{source} in the mock —
 * this route only backs the SPA's read path.
 */
@Controller('api/presets')
export class PresetsController {
  @Get()
  getPresets() {
    return {
      items: [
        {
          source: 'acme/web',
          name: 'Frontend defaults',
          version: 1,
          settings: {
            theme: 'dark',
            view: 'matrix',
            failOnly: false,
          },
          fetched_at: '2026-06-30T08:15:00Z',
        },
        {
          source: 'acme/infra',
          name: 'Ops incident view',
          version: 1,
          settings: {
            theme: 'light',
            view: 'matrix',
            failOnly: true,
          },
          fetched_at: '2026-06-29T21:42:00Z',
        },
      ],
    };
  }
}
