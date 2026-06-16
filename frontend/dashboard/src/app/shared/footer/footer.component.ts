import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';

import { DeploymentApiService } from '../../core/services/deployment-api.service';

/**
 * FooterComponent — fixed glass bar at viewport bottom.
 *
 * LEFT:  version chip (from GET /api/version) + Documentation link.
 * RIGHT: copyright + MIT License link.
 *
 * Version falls back to '…' while the request is in flight and to
 * '0.0.0-dev' on error (matches the API's own fallback semantics).
 *
 * Spec: docs/api/openapi.yaml #/paths/~1api~1version
 */
@Component({
  selector: 'app-footer',
  standalone: true,
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent implements OnInit {
  private readonly api = inject(DeploymentApiService);

  protected readonly version = signal<string>('…');

  readonly docsUrl = 'https://kostiantyn-matsebora.github.io/deployment-dashboard/';
  readonly authorUrl = 'https://github.com/kostiantyn-matsebora';
  readonly licenseUrl = 'https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/LICENSE';

  ngOnInit(): void {
    this.api.getVersion().subscribe({
      next:  (r) => this.version.set(r.version),
      error: ()  => this.version.set('0.0.0-dev'),
    });
  }
}
