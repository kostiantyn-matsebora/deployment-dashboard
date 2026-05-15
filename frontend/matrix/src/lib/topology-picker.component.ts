// FR-13 — Topology correlation-attribute picker.
//
// SAD §10 Decision #7 — the picker is localStorage-only and never invokes
// `PATCH /api/config/topology`. User clicks → write to localStorage (via
// the store's `setCorrelationAttribute`, picked up by
// `CorrelationPrefsService`) → next matrix GET appends
// `?correlationAttribute=<value>`. The picker also exposes a "system
// default" choice — when picked, the override is cleared and matrix GETs
// omit the query parameter so the server-side default applies.
//
// SAD §"Configuration — Read API topology" allowed values:
//   version | ref | sha | actor | run | ago
// (`id` is disallowed and absent from this list.)
//
// No `X-Api-Key`, no PATCH, no error toast — failures only exist on the
// server PATCH path, which the SPA never invokes.

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  VALID_CORRELATION_ATTRIBUTES,
  isCorrelationAttribute,
  type CorrelationAttribute
} from '@dd/shared';

interface CorrelationOption {
  key: CorrelationAttribute;
  label: string;
  hint: string;
}

/** Allowed correlation attributes per SAD §"Configuration — Read API topology". */
const CORRELATION_OPTIONS: readonly CorrelationOption[] = [
  { key: 'version', label: 'Version',     hint: 'Match by deployment.version' },
  { key: 'ref',     label: 'Ref',         hint: 'Match by git ref / branch name' },
  { key: 'sha',     label: 'SHA',         hint: 'Match by full commit SHA' },
  { key: 'actor',   label: 'Actor',       hint: 'Match by deploying user' },
  { key: 'run',     label: 'Run number',  hint: 'Match by CI run number' },
  { key: 'ago',     label: 'Elapsed time', hint: 'Match by elapsed-time bucket' }
];

@Component({
  selector: 'dd-topology-picker',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative" data-testid="topology-picker">
      <button
        type="button"
        class="flex items-center gap-1.5 text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 hover:bg-gray-50"
        [attr.aria-expanded]="open()"
        [attr.aria-haspopup]="'true'"
        title="Topology correlation attribute — used when deployments do not declare explicit parent_deployments"
        data-testid="topology-picker-button"
        (click)="toggleOpen($event)"
      >
        <svg class="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M4 6h16M7 12h13M10 18h10" />
        </svg>
        <span class="font-medium">Topology</span>
        <span class="text-gray-400" data-testid="topology-picker-attr">{{ currentLabel() }}</span>
        <svg class="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      @if (open()) {
        <div
          class="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg p-3 z-50"
          data-testid="topology-picker-popover"
          role="dialog"
          aria-label="Topology correlation attribute"
        >
          <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-2">
            Correlation attribute
          </p>
          <p class="text-[11px] text-gray-500 leading-snug mb-2">
            Used when deployments don't declare explicit
            <span class="font-mono">parent_deployments</span>.
          </p>
          <div class="space-y-1.5">
            <label
              class="flex items-start gap-2 text-sm cursor-pointer select-none hover:bg-gray-50 rounded px-1 -mx-1"
            >
              <input
                type="radio"
                name="topology-correlation"
                class="mt-0.5"
                data-testid="topology-option-system-default"
                [checked]="userPick() === undefined"
                (change)="selectSystemDefault()"
              />
              <span class="flex-1">
                <span class="font-medium text-gray-800">System default</span>
                <span class="block text-[11px] text-gray-400">
                  Use the server's configured fallback ({{ systemDefaultLabel() }})
                </span>
              </span>
            </label>
            @for (o of options; track o.key) {
              <label
                class="flex items-start gap-2 text-sm cursor-pointer select-none hover:bg-gray-50 rounded px-1 -mx-1"
              >
                <input
                  type="radio"
                  name="topology-correlation"
                  class="mt-0.5"
                  [attr.data-testid]="'topology-option-' + o.key"
                  [checked]="userPick() === o.key"
                  (change)="select(o.key)"
                />
                <span class="flex-1">
                  <span class="font-medium text-gray-800">{{ o.label }}</span>
                  <span class="block text-[11px] text-gray-400">{{ o.hint }}</span>
                </span>
              </label>
            }
          </div>
          <p class="text-[10px] text-gray-400 italic mt-2 leading-tight">
            Saved in your browser only. Takes effect on the next matrix
            refresh (≤ 5 s per NFR-03).
          </p>
        </div>
      }
    </div>
  `
})
export class TopologyPickerComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly store = inject(DeploymentMatrixStore);

  /**
   * Emitted whenever the user changes their pick (including clearing it
   * back to system default). The app component listens and re-issues a
   * `GET /api/deployments` with the new query parameter. Kept as an
   * `EventEmitter` so the parent can subscribe without coupling to a
   * cross-store signal.
   */
  @Output() readonly pickChanged = new EventEmitter<CorrelationAttribute | undefined>();

  readonly options = CORRELATION_OPTIONS;
  readonly open = signal(false);

  /** The user's persisted pick (or undefined when following the system default). */
  readonly userPick = computed<CorrelationAttribute | undefined>(() =>
    this.store.correlationAttribute()
  );

  /** Label rendered next to the "Topology" button. Falls back to the system default. */
  readonly currentLabel = computed(() => {
    const pick = this.userPick();
    if (pick) return CORRELATION_OPTIONS.find(o => o.key === pick)?.label ?? pick;
    return this.systemDefaultLabel();
  });

  readonly systemDefaultLabel = computed(() => {
    const cfg = this.store.topologyConfig();
    const key = cfg?.correlationAttribute;
    if (!key) return '—';
    const known = CORRELATION_OPTIONS.find(o => o.key === key);
    return known ? known.label : key;
  });

  toggleOpen(ev: MouseEvent): void {
    ev.stopPropagation();
    this.open.update(v => !v);
  }

  /** Click-outside closes the popover. */
  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const target = ev.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
    }
  }

  /** Pick a specific attribute. Defensive — ignores unknown keys. */
  select(key: string): void {
    if (!isCorrelationAttribute(key)) return;
    if (this.userPick() === key) {
      this.open.set(false);
      return;
    }
    this.store.setCorrelationAttribute(key);
    this.pickChanged.emit(key);
    this.open.set(false);
  }

  /** Pick "system default" — clears the user override. */
  selectSystemDefault(): void {
    if (this.userPick() === undefined) {
      this.open.set(false);
      return;
    }
    this.store.setCorrelationAttribute(undefined);
    this.pickChanged.emit(undefined);
    this.open.set(false);
  }

  /** Test helper — surface the allowed keys for spec assertions. */
  static readonly ALLOWED_KEYS = VALID_CORRELATION_ATTRIBUTES;
}
