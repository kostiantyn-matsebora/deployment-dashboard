// /invariants route — renders the NFR-09 harness invariant catalogue.
// Data sourced from mockup/src/app/fixtures/invariants-data.ts, which is a
// hardcoded copy of testing/mockup-visual/harness.config.json invariant metadata.
// Renders: active invariants (I0–I10 + I12), deferred section (I11 + Phase 2.0),
//          view exceptions table, severity bands table.

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ACTIVE_INVARIANTS,
  DEFERRED_INVARIANTS,
  VIEW_EXCEPTIONS,
  SEVERITY_BANDS
} from '../fixtures/invariants-data';

@Component({
  selector: 'dd-mockup-invariants-route',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-6 py-6 max-w-4xl space-y-8" data-testid="invariants-page">

      <!-- Page header -->
      <div>
        <div class="flex items-center gap-3 mb-1">
          <h2 class="text-base font-semibold text-gray-800" data-testid="invariants-page-title">
            Visual harness invariants (NFR-09)
          </h2>
          <span class="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5 uppercase tracking-wider">
            {{ activeInvariants.length }} active
          </span>
          <span class="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded px-2 py-0.5 uppercase tracking-wider">
            {{ deferredInvariants.length }} deferred
          </span>
        </div>
        <p class="text-xs text-gray-500">
          Source: <code class="font-mono bg-gray-100 px-1 rounded">testing/mockup-visual/harness.config.json</code>
          — active invariants run against every
          <strong>View × Layout × Theme</strong> combination.
          Deferred invariants are preserved for Phase 2.0 (Matrix layout).
        </p>
      </div>

      <!-- Active invariants -->
      <section data-testid="active-invariants-section">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          Active invariants
          <span class="normal-case font-normal text-gray-400">({{ activeInvariants.length }} rules · Layouts: swim-lane, workflow-rows · Views: detailed, compact, glance, focus)</span>
        </h3>

        <div class="border border-gray-200 rounded-lg overflow-hidden">
          <table class="w-full text-xs border-collapse" data-testid="active-invariants-table">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-200">
                <th class="text-left px-3 py-2 font-semibold text-gray-600 w-48">ID</th>
                <th class="text-left px-3 py-2 font-semibold text-gray-600">Description</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (inv of activeInvariants; track inv.id) {
                <tr
                  class="hover:bg-gray-50 transition-colors"
                  [attr.data-testid]="'invariant-row-' + inv.id"
                >
                  <td class="px-3 py-2.5 align-top">
                    <code
                      class="font-mono text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 whitespace-nowrap"
                      [attr.data-testid]="'invariant-id-' + inv.id"
                    >{{ inv.id }}</code>
                  </td>
                  <td
                    class="px-3 py-2.5 text-gray-700 leading-snug align-top"
                    [attr.data-testid]="'invariant-label-' + inv.id"
                  >{{ inv.label }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Deferred invariants -->
      <section data-testid="deferred-invariants-section">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          Deferred invariants
          <span class="normal-case font-normal text-gray-400">(Phase 2.0 — Matrix layout)</span>
        </h3>

        <div class="border border-dashed border-gray-300 rounded-lg overflow-hidden bg-gray-50">
          <table class="w-full text-xs border-collapse" data-testid="deferred-invariants-table">
            <thead>
              <tr class="bg-gray-100 border-b border-gray-200">
                <th class="text-left px-3 py-2 font-semibold text-gray-500 w-48">ID</th>
                <th class="text-left px-3 py-2 font-semibold text-gray-500">Description</th>
                <th class="text-left px-3 py-2 font-semibold text-gray-500">Deferral reason</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              @for (inv of deferredInvariants; track inv.id) {
                <tr [attr.data-testid]="'deferred-invariant-row-' + inv.id">
                  <td class="px-3 py-2.5 align-top">
                    <code
                      class="font-mono text-[10px] text-gray-500 bg-gray-200 border border-gray-300 rounded px-1.5 py-0.5 whitespace-nowrap"
                      [attr.data-testid]="'deferred-invariant-id-' + inv.id"
                    >{{ inv.id }}</code>
                  </td>
                  <td
                    class="px-3 py-2.5 text-gray-500 leading-snug align-top"
                    [attr.data-testid]="'deferred-invariant-label-' + inv.id"
                  >{{ inv.label }}</td>
                  <td class="px-3 py-2.5 text-gray-400 italic leading-snug align-top max-w-xs">{{ inv.deferralReason }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- View exceptions -->
      <section data-testid="view-exceptions-section">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          View exceptions
          <span class="normal-case font-normal text-gray-400">(approved relaxations — each must be narrow and cite authoritative doc)</span>
        </h3>

        <div class="border border-amber-200 rounded-lg overflow-hidden bg-amber-50">
          <table class="w-full text-xs border-collapse" data-testid="view-exceptions-table">
            <thead>
              <tr class="bg-amber-100 border-b border-amber-200">
                <th class="text-left px-3 py-2 font-semibold text-amber-800 w-24">View</th>
                <th class="text-left px-3 py-2 font-semibold text-amber-800 w-56">Invariant relaxed</th>
                <th class="text-left px-3 py-2 font-semibold text-amber-800">Rationale</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-amber-100">
              @for (ex of viewExceptions; track ex.view + ':' + ex.invariantId) {
                <tr [attr.data-testid]="'view-exception-' + ex.view + '-' + ex.invariantId">
                  <td class="px-3 py-2.5 align-top">
                    <code class="font-mono text-[10px] text-amber-800 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">{{ ex.view }}</code>
                  </td>
                  <td class="px-3 py-2.5 align-top">
                    <code class="font-mono text-[10px] text-amber-700 whitespace-nowrap">{{ ex.invariantId }}</code>
                  </td>
                  <td class="px-3 py-2.5 text-amber-900 leading-snug align-top">{{ ex.rationale }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Severity bands (I12 / rate-limit cluster) -->
      <section data-testid="severity-bands-section">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          I12 severity bands
          <span class="normal-case font-normal text-gray-400">(rate-limit cluster — CR-0011 locks; thresholds are CR-0011-level locked)</span>
        </h3>

        <div class="border border-gray-200 rounded-lg overflow-hidden">
          <table class="w-full text-xs border-collapse" data-testid="severity-bands-table">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-200">
                <th class="text-left px-3 py-2 font-semibold text-gray-600 w-24">Band</th>
                <th class="text-left px-3 py-2 font-semibold text-gray-600 w-32">Threshold</th>
                <th class="text-left px-3 py-2 font-semibold text-gray-600 w-36">Light-mode token</th>
                <th class="text-left px-3 py-2 font-semibold text-gray-600">Rationale</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (band of severityBands; track band.name) {
                <tr
                  class="hover:bg-gray-50 transition-colors"
                  [attr.data-testid]="'severity-band-' + band.name"
                >
                  <td class="px-3 py-2.5 align-top">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold"
                      [class.bg-green-100]="band.name === 'green'"
                      [class.text-green-800]="band.name === 'green'"
                      [class.bg-amber-100]="band.name === 'amber'"
                      [class.text-amber-800]="band.name === 'amber'"
                      [class.bg-red-100]="band.name === 'red'"
                      [class.text-red-800]="band.name === 'red'"
                      [class.bg-gray-100]="band.name === 'stale'"
                      [class.text-gray-600]="band.name === 'stale'"
                    >{{ band.name }}</span>
                  </td>
                  <td class="px-3 py-2.5 align-top text-gray-600">
                    @if (band.name === 'stale') {
                      <span class="text-gray-500 italic">time-based</span>
                    } @else {
                      <code class="font-mono">{{ thresholdLabel(band) }}</code>
                    }
                  </td>
                  <td class="px-3 py-2.5 align-top">
                    <code class="font-mono text-[10px] text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">{{ band.lightToken }}</code>
                  </td>
                  <td class="px-3 py-2.5 text-gray-600 align-top">{{ band.rationale }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-[10px] text-gray-400">
          Collapse threshold: viewport &lt; 1280 px · Stale threshold: 120 000 ms (2 × poll_interval = 2 × 60 s).
          Severity-band thresholds are CR-0011-level locks; light-mode tokens come from CR-0006 (theme axis).
        </p>
      </section>

    </div>
  `
})
export class InvariantsRouteComponent {
  readonly activeInvariants = ACTIVE_INVARIANTS;
  readonly deferredInvariants = DEFERRED_INVARIANTS;
  readonly viewExceptions = VIEW_EXCEPTIONS;
  readonly severityBands = SEVERITY_BANDS;

  thresholdLabel(band: typeof SEVERITY_BANDS[number]): string {
    if (band.min !== undefined && band.max !== undefined) {
      return `${(band.min * 100).toFixed(0)}–${(band.max * 100).toFixed(0)}%`;
    }
    if (band.max !== undefined) return `< ${(band.max * 100).toFixed(0)}%`;
    if (band.min !== undefined) return `> ${(band.min * 100).toFixed(0)}%`;
    return '—';
  }
}
