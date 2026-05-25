// Variant route — env-tag column alignment, Variant B (shared-max width).
// Demonstrates the shared-max CSS variable strategy from issue #23:
//   a single --env-tag-col-width written on each .svc-block set to the
//   maximum env-tag width across ALL positions and ALL rows.
// Trade-off: every position reserves the widest-anywhere column, even where
// the actual env-tag is narrow — but no position-index plumbing in the template.
//
// Data: uses BRANCHING fixture so QAHOTFIX (wide) dominates the shared max,
// making all other positions inflate to QAHOTFIX width — the contrast with A.

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutLeafComponent } from '../chrome/layout-leaf.component';
import { StatsBarComponent } from '../chrome/stats-bar.component';
import {
  BRANCHING_ENVIRONMENTS,
  BRANCHING_SERVICES,
  MOCKUP_MATRIX_BRANCHING,
  MOCKUP_TOPOLOGY_BRANCHING
} from '../fixtures/variants/branching';
import type {
  ServiceDescriptor, EnvironmentDescriptor, MatrixState, TopologyState, SlotState, Topology
} from '../fixtures/index';

// Root-to-leaf paths — mirrors topology-utils.ts rootToLeafPaths().
function rootToLeafPaths(
  topology: Topology,
  service: ServiceDescriptor,
  environments: readonly EnvironmentDescriptor[],
  matrix: MatrixState
): readonly (readonly string[])[] {
  const edges = topology.edges;
  if (edges.length === 0) {
    const populated = environments
      .filter(e => matrix[service.id]?.[e.id] != null)
      .sort((a, b) => {
        const ta = new Date(matrix[service.id]?.[a.id]?.current.deployedAt ?? 0).getTime();
        const tb = new Date(matrix[service.id]?.[b.id]?.current.deployedAt ?? 0).getTime();
        return ta - tb;
      })
      .map(e => e.id);
    return [populated];
  }
  const children: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  const allNodes = new Set<string>();
  for (const e of edges) {
    allNodes.add(e.from);
    allNodes.add(e.to);
    (children[e.from] ??= []).push(e.to);
    inDegree[e.to] = (inDegree[e.to] ?? 0) + 1;
  }
  const roots = [...allNodes].filter(n => !inDegree[n]);
  const paths: string[][] = [];
  function dfs(node: string, path: string[]): void {
    const next = path.concat(node);
    const kids = children[node] ?? [];
    if (kids.length === 0) { paths.push(next); return; }
    for (const c of kids) dfs(c, next);
  }
  for (const r of roots) dfs(r, []);
  return paths.length > 0 ? paths : [[...allNodes]];
}

const AVG_CHAR_PX = 7.5;

function approxTagPx(label: string): number {
  return Math.ceil(label.length * AVG_CHAR_PX) + 2;
}

// Compute the single block-wide max env-tag width across ALL paths and ALL positions.
function computeSharedMaxWidth(
  paths: readonly (readonly string[])[],
  environments: readonly EnvironmentDescriptor[]
): string {
  let max = 0;
  for (const path of paths) {
    for (const envId of path) {
      const label = environments.find(e => e.id === envId)?.label ?? envId.toUpperCase();
      const px = approxTagPx(label);
      if (px > max) max = px;
    }
  }
  return max > 0 ? `${max}px` : 'auto';
}

// Build inline style object for Variant B — single shared CSS custom property.
function variantBStyle(maxWidth: string): Record<string, string> {
  return { '--env-tag-col-width': maxWidth };
}

@Component({
  selector: 'dd-mockup-env-tag-b-route',
  standalone: true,
  imports: [CommonModule, LayoutLeafComponent, StatsBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <div class="px-6 py-2 text-xs text-gray-500 bg-white border-b border-gray-100">
        Variant: <strong class="text-gray-700">Env-tag alignment B — shared-max width</strong>
        — single <code class="font-mono bg-gray-100 px-1 rounded">--env-tag-col-width</code>
        per svc-block; all positions inflate to the widest tag anywhere in the block
      </div>
      <dd-mockup-stats-bar
        [failureCount]="failureCount"
        [runningCount]="runningCount"
      ></dd-mockup-stats-bar>

      <div class="px-6 py-2 text-[10px] text-blue-700 bg-blue-50 border-b border-blue-100">
        Strategy B: a single max width across ALL positions and ALL rows. Simpler template
        (no <code class="font-mono">data-env-position</code> plumbing), but every position
        reserves the widest-anywhere column — visibly wider than Variant A at narrow positions.
      </div>

      <main
        class="px-6 py-2 space-y-3"
        data-testid="pipeline-matrix"
        data-view="detailed"
        data-layout="workflow-rows"
        data-variant="env-tag-b"
      >
        @for (service of services; track service.id) {
          <section
            class="svc-block"
            [attr.data-service]="service.id"
            [attr.data-testid]="'env-tag-b-' + service.id"
            [ngStyle]="svcBlockStyleB(service)"
          >
            <!-- Meta column -->
            <div class="svc-block-meta">
              <div class="svc-block-meta-row">
                <p
                  class="text-sm font-semibold text-gray-800 whitespace-nowrap"
                  style="width: max-content"
                  [attr.data-testid]="'service-name-' + service.id"
                >{{ service.name }}</p>
                <span class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight ml-1 shrink-0">
                  {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
                </span>
              </div>
              <p class="text-[10px] text-gray-400 italic leading-tight">B: shared-max width</p>
            </div>

            <!-- All workflow rows (all paths shown; no data-env-position — reads shared var) -->
            <div class="svc-block-rows">
              @for (path of pathsFor(service); track $index; let pathIdx = $index) {
                <div
                  class="wf-row"
                  [class.default-row]="pathIdx === 0"
                  [attr.data-testid]="'wf-row-' + service.id + '-' + pathIdx"
                >
                  <div class="flex items-stretch">
                    @for (envId of path; track envId + ':' + $index; let idx = $index) {
                      <div class="flex items-stretch">
                        <!-- No data-env-position attribute: leaf-pair reads --env-tag-col-width
                             directly from the svc-block inline style (Variant B strategy). -->
                        <div
                          class="leaf-pair relative"
                          [attr.data-env]="envId"
                        >
                          <span class="env-tag">{{ envLabel(envId) }}</span>
                          <dd-mockup-layout-leaf
                            [service]="service"
                            [env]="envFor(envId)"
                            [slot]="slotFor(service, envId)"
                          ></dd-mockup-layout-leaf>
                        </div>
                        @if (idx < path.length - 1) {
                          <div class="arrow-gap">
                            <div class="arrow-line"></div>
                          </div>
                        }
                      </div>
                    }
                    @if (pathIdx === 0 && pathsFor(service).length > 1) {
                      <div class="flex items-center pl-3">
                        <span class="default-tag" data-testid="workflow-default-tag">default</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }
      </main>
    </div>
  `
})
export class EnvTagBRouteComponent {
  readonly services = BRANCHING_SERVICES;
  readonly environments = BRANCHING_ENVIRONMENTS;
  readonly matrix = MOCKUP_MATRIX_BRANCHING;
  readonly topology = MOCKUP_TOPOLOGY_BRANCHING;

  pathsFor(service: ServiceDescriptor): readonly (readonly string[])[] {
    return rootToLeafPaths(
      this.topology[service.id] ?? { edges: [] },
      service,
      this.environments,
      this.matrix
    );
  }

  svcBlockStyleB(service: ServiceDescriptor): Record<string, string> {
    const paths = this.pathsFor(service);
    const maxWidth = computeSharedMaxWidth(paths, this.environments);
    return variantBStyle(maxWidth);
  }

  envLabel(envId: string): string {
    return this.environments.find(e => e.id === envId)?.label ?? envId.toUpperCase();
  }

  envFor(envId: string): EnvironmentDescriptor {
    return this.environments.find(e => e.id === envId) ?? { id: envId, label: envId.toUpperCase() };
  }

  slotFor(service: ServiceDescriptor, envId: string): SlotState | null {
    return this.matrix[service.id]?.[envId] ?? null;
  }

  get failureCount(): number {
    let n = 0;
    for (const svc of Object.values(this.matrix)) {
      for (const slot of Object.values(svc)) {
        if (slot?.current.status === 'failure') n++;
      }
    }
    return n;
  }

  get runningCount(): number {
    let n = 0;
    for (const svc of Object.values(this.matrix)) {
      for (const slot of Object.values(svc)) {
        if (slot?.current.status === 'in-progress') n++;
      }
    }
    return n;
  }
}
