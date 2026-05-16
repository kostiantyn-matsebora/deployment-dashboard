// Detailed-view row — canonical layout: 11rem service label column,
// 10rem stage boxes with arrow connectors. Mirrors the mockup's "Detailed
// view" template (docs/deployment-dashboard.html lines 236–350).

import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  type EnvironmentDescriptor,
  type ServiceDescriptor
} from '@dd/shared';
import { StageBoxComponent } from './stage-box.component';

@Component({
  selector: 'dd-detailed-row',
  standalone: true,
  imports: [CommonModule, StageBoxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-white rounded-lg border border-gray-200 px-4 py-3"
      [attr.data-testid]="'service-row-' + service().id"
      [attr.data-service-row]="service().id"
      data-view="detailed"
    >
      <div class="flex items-center">
        <div class="w-44 shrink-0 pr-4">
          <!-- NFR-09 #6 — single-line at intrinsic width, no truncate / no
               ellipsis / no wrap. whitespace-nowrap + inline
               width:max-content makes the <p> auto-size to its content
               so scrollWidth equals clientWidth by construction. The w-44
               container remains as a visual reservation; long names
               overflow it visually but never clip. -->
          <p
            class="text-sm font-semibold text-gray-800 whitespace-nowrap"
            style="width: max-content"
            [attr.data-testid]="'service-name-' + service().id"
            [title]="service().name"
          >{{ service().name }}</p>
          <p class="text-xs text-gray-400 mt-0.5">{{ summary() }}</p>
        </div>
        <div class="flex items-center overflow-x-auto">
          @for (env of envs(); track env.id; let idx = $index) {
            <div class="flex items-center">
              <dd-stage-box
                [service]="service()"
                [env]="env"
                [slot]="slotFor(env)"
                (opened)="opened.emit($event)"
              ></dd-stage-box>
              @if (idx < envs().length - 1) {
                <div class="flex items-center justify-center w-10">
                  <div class="arrow-line"></div>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class DetailedRowComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly service = input.required<ServiceDescriptor>();
  readonly envs = input.required<readonly EnvironmentDescriptor[]>();
  readonly opened = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  slotFor(env: EnvironmentDescriptor) {
    return this.store.matrix()[this.service().id]?.[env.id] ?? null;
  }

  summary(): string {
    const envs = this.store.matrix()[this.service().id] ?? {};
    const failures = Object.values(envs).filter(
      s => s?.current.status === 'failure'
    ).length;
    return failures > 0 ? `${failures} failure(s)` : 'All green';
  }
}
