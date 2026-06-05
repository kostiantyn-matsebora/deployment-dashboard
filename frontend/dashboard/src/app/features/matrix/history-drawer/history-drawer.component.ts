import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { DeploymentApiService } from '../../../core/services/deployment-api.service';
import { DeploymentEvent } from '../../../core/models/deployment.model';
import { TimeAgoPipe, absoluteUtc } from '../../../shared/pipes/time-ago.pipe';

/**
 * HistoryDrawerComponent — slide-in right panel showing per-slot deployment log.
 *
 * Spec: docs/design/components.md §History Drawer
 * Custom CSS-animated drawer (position: fixed) — avoids PrimeNG p-drawer
 * stacking-context issues with backdrop-filter containers.
 *
 * Opens when [open] = true. Emits (closed) when ESC / overlay / × are triggered.
 * Fetches GET /api/deployments?service=X&environment=Y on each open.
 */
@Component({
  selector: 'app-history-drawer',
  standalone: true,
  imports: [TimeAgoPipe],
  templateUrl: './history-drawer.component.html',
  styleUrl: './history-drawer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryDrawerComponent {
  private readonly api = inject(DeploymentApiService);

  // ── Inputs ────────────────────────────────────────────────
  readonly open        = input<boolean>(false);
  readonly service     = input<string>('');
  readonly environment = input<string>('');

  // ── Outputs ───────────────────────────────────────────────
  readonly closed = output<void>();

  // ── State ─────────────────────────────────────────────────
  protected readonly events  = signal<DeploymentEvent[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly error   = signal<boolean>(false);

  /** breadcrumb label shown in the drawer header */
  protected readonly crumbs = computed(() =>
    this.service() && this.environment()
      ? `${this.service()} · ${this.environment()}`
      : '—'
  );

  constructor() {
    // Fetch history whenever the drawer opens with a valid service+env pair.
    effect(() => {
      if (this.open() && this.service() && this.environment()) {
        this.loadHistory();
      } else if (!this.open()) {
        // Clear stale data when the drawer closes so it doesn't flash old
        // content when reopened for a different slot.
        this.events.set([]);
      }
    });
  }

  private loadHistory(): void {
    this.loading.set(true);
    this.error.set(false);
    this.api
      .listDeployments({
        service: this.service(),
        environment: this.environment(),
        limit: 50,
      })
      .subscribe({
        next: (page) => {
          this.events.set(page.items);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }

  // ── UI helpers ────────────────────────────────────────────
  protected statusClass(status: string): string {
    return status === 'in-progress' ? 's-progress' : `s-${status}`;
  }

  protected statusLabel(status: string): string {
    switch (status) {
      case 'in-progress': return 'In Progress';
      case 'success':     return 'Success';
      case 'failure':     return 'Failed';
      case 'pending':     return 'Pending';
      case 'queued':      return 'Queued';
      case 'waiting':     return 'Waiting';
      case 'cancelled':   return 'Cancelled';
      case 'rejected':    return 'Rejected';
      default:            return status;
    }
  }

  protected formatAbsolute(iso: string): string {
    return absoluteUtc(iso);
  }

  protected truncateId(id: string): string {
    return id.length > 16 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
  }

  // ── Event handlers ────────────────────────────────────────
  protected onClose(): void {
    this.closed.emit();
  }

  protected onOverlayClick(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.closed.emit();
  }
}
