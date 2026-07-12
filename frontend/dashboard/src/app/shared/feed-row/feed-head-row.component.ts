import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * FeedHeadRowComponent — sticky uppercase mono header row for the shared
 * 14-slot feed grid (#397). Column order matches FeedRowComponent exactly —
 * both reference the same `--feed-cols` custom property (defined once,
 * globally, in styles.css) so the page and dock header/rows can never drift
 * out of alignment.
 *
 * Spec: docs/design/mockup/index.html §FEED_HEAD_LABELS / feedBuildHeadRow
 */
@Component({
  selector: 'app-feed-head-row',
  standalone: true,
  templateUrl: './feed-head-row.component.html',
  styleUrl: './feed-head-row.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedHeadRowComponent {
  protected readonly labels = [
    '', '', 'Time', 'Service', 'Env', 'Status', 'Version', 'Ref', 'SHA', 'Run', 'Actor', 'Deployment', '', '',
  ];
}
