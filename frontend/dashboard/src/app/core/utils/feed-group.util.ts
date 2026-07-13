import { DeploymentEvent } from '../models/deployment.model';
import { ServiceIdentity } from './glob.util';

/**
 * One deployment_id group — events newest-first (mirrors the array's own order).
 */
export interface FeedGroup {
  id: string;
  events: DeploymentEvent[];
}

/**
 * Group a newest-first flat event list by `deployment_id`, preserving order.
 *
 * Because the input is already newest-first, a simple single pass preserves
 * both invariants for free:
 *   - within a group, `events` stays newest-first (later occurrences in the
 *     input are older events of the same deployment);
 *   - groups themselves are ordered by each group's first (= newest) event.
 *
 * Spec: docs/design/mockup/index.html §FEED_GROUPS / FEED_GROUP_ORDER — ported
 * 1:1 from the mockup's incremental Map + order-array construction.
 */
export function groupFeedEvents(events: DeploymentEvent[]): FeedGroup[] {
  const groups = new Map<string, FeedGroup>();
  const order: string[] = [];

  for (const ev of events) {
    let group = groups.get(ev.deployment_id);
    if (!group) {
      group = { id: ev.deployment_id, events: [] };
      groups.set(ev.deployment_id, group);
      order.push(ev.deployment_id);
    }
    group.events.push(ev);
  }

  return order.map((id) => groups.get(id)!);
}

/**
 * Distinct (service, namespace) identities from a loaded event list, in
 * first-seen order — the "visible set" AppStateService.rowLabel's
 * render-on-collision rule (issue #353) checks for a namespace collision.
 *
 * The Feed page and the dock each call this over their OWN loaded set
 * (pageEvents vs dockEvents) — collisions are judged independently per
 * surface, not across both (#397 FIX).
 */
export function visibleIdentitiesFromEvents(events: DeploymentEvent[]): ServiceIdentity[] {
  const seen = new Set<string>();
  const result: ServiceIdentity[] = [];
  for (const ev of events) {
    const key = `${ev.namespace ?? ''}|${ev.service}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ service: ev.service, namespace: ev.namespace });
    }
  }
  return result;
}
