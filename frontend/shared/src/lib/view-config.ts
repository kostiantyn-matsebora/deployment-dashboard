// FR-12 — declarative configuration for the four layout views and the
// attribute picker. Per the frontend-engineer "Declarative configuration
// only" rule: view names, defaults, caps, attribute keys + labels, and the
// `localStorage` keys live here only — never inline in component code.
//
// Source of truth: docs/deployment-dashboard-architecture.md §7 "Visual
// layout" + docs/ui/compact-options.md.

/** The four user-selectable matrix layout views. */
export type ViewId = 'detailed' | 'compact' | 'glance' | 'focus';

/**
 * The seven matrix-grid attribute keys exposed in the picker (FR-02 / FR-12).
 *
 * `ref` + `sha` joined the canonical set per SAD §7 "Attribute vocabulary"
 * table — both are nullable on the wire (FR-05). Slots whose chosen
 * attribute is null/absent render the attribute slot empty per the
 * SAD §7 "Null-render invariant for nullable attributes" — never the
 * literal string `"null"` / `"undefined"`.
 */
export type AttrKey = 'status' | 'version' | 'run' | 'ago' | 'actor' | 'ref' | 'sha';

/**
 * Overall arrangement of services × envs. Orthogonal to ViewId — the View axis
 * controls the *leaf renderer* (per-box density / attributes); the Layout axis
 * controls the *outer arrangement* (services × envs grid vs lanes vs paths).
 * See docs/ui/tree-topology-options.md.
 */
export type LayoutId = 'matrix' | 'swim-lane' | 'workflow-rows';

/** Static descriptor for a layout view (label, description, defaults, cap). */
export interface ViewDescriptor {
  readonly id: ViewId;
  readonly label: string;
  readonly description: string;
  readonly defaults: readonly AttrKey[];
  /** Maximum number of attributes selectable in the picker for this view. */
  readonly maxAttrs: number;
  /** Helper text rendered under the checkbox list in the popover. */
  readonly attrHint: string;
}

/** Static descriptor for a picker attribute (label + tooltip line). */
export interface AttrDescriptor {
  readonly key: AttrKey;
  readonly label: string;
  readonly description: string;
}

/** Static descriptor for a layout option. */
export interface LayoutDescriptor {
  readonly id: LayoutId;
  readonly label: string;
  /** One-sentence intent — mirrors the mockup LAYOUTS table description. */
  readonly intent: string;
}

/** Picker attributes in canonical display order. */
export const ATTRIBUTES: readonly AttrDescriptor[] = [
  { key: 'status',  label: 'Status badge', description: 'success / failed / running… text on the box' },
  { key: 'version', label: 'Version',      description: 'Semver string (e.g. v2.3.1)' },
  { key: 'run',     label: 'Run number',   description: 'CI/CD run number, links to run_url' },
  { key: 'ago',     label: 'Elapsed time', description: 'Relative time since deployment' },
  { key: 'actor',   label: 'Actor',        description: 'Person who triggered the deploy' },
  { key: 'ref',     label: 'Source ref',   description: 'Branch / PR / tag (nullable)' },
  { key: 'sha',     label: 'Commit SHA',   description: 'Commit hash (nullable; may be truncated)' }
];

/** Valid attribute key set — used to filter persisted values. */
export const VALID_ATTR_KEYS: readonly AttrKey[] =
  ATTRIBUTES.map(a => a.key);

/**
 * Views in canonical display order (matches the segmented control).
 *
 * Caps per SAD §7 "Layout views (FR-12)" table: Detailed 7, Compact 5,
 * Glance 1, Focus 5. The default selections stay the canonical first-paint
 * five (Detailed) / four (Compact / Focus) / one (Glance); users opt in to
 * the additional `ref` / `sha` attributes via the picker.
 */
export const VIEWS: readonly ViewDescriptor[] = [
  {
    id: 'detailed',
    label: 'Detailed',
    description: 'Full per-slot detail — the original canonical layout',
    defaults: ['status', 'version', 'run', 'ago', 'actor'],
    maxAttrs: 7,
    attrHint: 'All seven attributes fit. Drop any to declutter; ref / sha render empty when null.'
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Dense matrix — ~120 px boxes, ~36 px rows, fits ~15 services per screen',
    defaults: ['status', 'version', 'run', 'ago'],
    maxAttrs: 5,
    attrHint: 'Up to 5 attributes — pick one of actor / ref / sha alongside the canonical four.'
  },
  {
    id: 'glance',
    label: 'Glance',
    description: 'List of status pills — at-a-glance triage view, one attribute per pill',
    defaults: ['version'],
    maxAttrs: 1,
    attrHint: 'Pill shows status colour + ✓/✗ icon plus one attribute (version, ref, sha, actor, run, ago).'
  },
  {
    id: 'focus',
    label: 'Focus',
    description: 'Compact rows by default; click chevron to drill into a service',
    defaults: ['status', 'version', 'run', 'ago'],
    maxAttrs: 5,
    attrHint: 'Cap applies to collapsed rows. Expanded/pinned rows always show all 7.'
  }
];

/** Look up a view descriptor by id (compile-time exhaustive). */
export const VIEW_BY_ID: Readonly<Record<ViewId, ViewDescriptor>> =
  VIEWS.reduce((acc, v) => ({ ...acc, [v.id]: v }), {} as Record<ViewId, ViewDescriptor>);

/** Per-view caps as a plain map for derived signals. */
export const CAPS: Readonly<Record<ViewId, number>> =
  VIEWS.reduce((acc, v) => ({ ...acc, [v.id]: v.maxAttrs }), {} as Record<ViewId, number>);

/** Per-view default attribute selection. */
export const DEFAULT_ATTRS: Readonly<Record<ViewId, readonly AttrKey[]>> =
  VIEWS.reduce((acc, v) => ({ ...acc, [v.id]: v.defaults }), {} as Record<ViewId, readonly AttrKey[]>);

/** Layouts in canonical display order (matches the segmented control). */
export const LAYOUTS: readonly LayoutDescriptor[] = [
  {
    id: 'matrix',
    label: 'Matrix',
    intent: 'Services × environments grid — original canonical arrangement'
  },
  {
    id: 'swim-lane',
    label: 'Swim-lane',
    intent: 'Services as lanes; envs grouped into logical columns by topological depth'
  },
  {
    id: 'workflow-rows',
    label: 'Workflow rows',
    intent: 'One row per root-to-leaf path; collapsed by default to the path containing the latest event'
  }
];

/** Look up a layout descriptor by id (compile-time exhaustive). */
export const LAYOUT_BY_ID: Readonly<Record<LayoutId, LayoutDescriptor>> =
  LAYOUTS.reduce((acc, l) => ({ ...acc, [l.id]: l }), {} as Record<LayoutId, LayoutDescriptor>);

/** Valid layout id set — used to filter persisted values. */
export const VALID_LAYOUT_IDS: readonly LayoutId[] =
  LAYOUTS.map(l => l.id);

/** localStorage keys for the view + per-view attribute selections + layout. */
export const STORAGE_KEYS = {
  view: 'dashboard.view',
  layout: 'dashboard.layout',
  focusOnLastEvent: 'dashboard.focusOnLastEvent',
  /**
   * SAD §10 Decision #7 + §7 "Visual layout" localStorage table — the user's
   * per-tab correlation-attribute override. Read-only on the API; the SPA
   * never PATCHes /api/config/topology.
   */
  correlationAttribute: 'dashboard.correlationAttribute',
  /**
   * SAD §7 "Visual layout" localStorage table — the user's theme preference.
   * One of `light` / `dark` / `auto` (`auto` follows OS prefers-color-scheme).
   */
  theme: 'dashboard.theme',
  attrsPrefix: 'dashboard.attrs.',
  attrsFor(viewId: ViewId): string {
    return `dashboard.attrs.${viewId}`;
  }
} as const;

/** Direct constants — kept alongside STORAGE_KEYS so tests can import either form. */
export const STORAGE_KEY_LAYOUT = STORAGE_KEYS.layout;
export const STORAGE_KEY_FOCUS_ON_LAST_EVENT = STORAGE_KEYS.focusOnLastEvent;
export const STORAGE_KEY_CORRELATION_ATTRIBUTE = STORAGE_KEYS.correlationAttribute;
export const STORAGE_KEY_THEME = STORAGE_KEYS.theme;

/**
 * Allowed correlation-attribute values, per SAD §"Configuration — Read API
 * topology" and §"API Contract" → "GET /api/deployments — query parameters".
 * `id` is explicitly DISALLOWED (deployment_id is the explicit key, not a
 * correlation attribute). The set is duplicated from `topology-picker.component.ts`
 * here so the localStorage hardening rule in `correlation-prefs.service.ts`
 * stays declarative.
 */
export type CorrelationAttribute = 'version' | 'ref' | 'sha' | 'actor' | 'run' | 'ago';
export const VALID_CORRELATION_ATTRIBUTES: readonly CorrelationAttribute[] =
  ['version', 'ref', 'sha', 'actor', 'run', 'ago'];
export function isCorrelationAttribute(v: unknown): v is CorrelationAttribute {
  return typeof v === 'string'
    && (VALID_CORRELATION_ATTRIBUTES as readonly string[]).includes(v);
}

// ============================================================================
// Theme axis (palette swap — orthogonal to view + layout). SAD §7 "Visual
// layout" + docs/ui/theme-options.md. The user-facing preference enum is
// `light | dark | auto`; the *effective* palette is `light | dark` (auto
// resolves against prefers-color-scheme at runtime). Theme is a pure
// palette concern — never controls layout, density, attribute selection,
// or the 6-box-state semantics.
// ============================================================================

/** User-facing theme preference — what the popover radios bind to. */
export type ThemePreference = 'light' | 'dark' | 'auto';

/** Effective palette after `auto` is resolved against the OS preference. */
export type EffectiveTheme = 'light' | 'dark';

export interface ThemeDescriptor {
  readonly id: ThemePreference;
  readonly label: string;
  /** Short subtitle rendered to the right of the radio label in the popover. */
  readonly hint: string;
}

/** Mirrors `THEMES` in the canonical mockup (docs/ui/deployment-dashboard.html line 2722). */
export const THEMES: readonly ThemeDescriptor[] = [
  { id: 'light', label: 'Light', hint: '' },
  { id: 'dark',  label: 'Dark',  hint: 'Dim' },
  { id: 'auto',  label: 'Auto',  hint: 'follow OS' }
];

export const VALID_THEME_PREFERENCES: readonly ThemePreference[] = THEMES.map(t => t.id);

/** Default preference for first-time visitors — mirrors the mockup default. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'auto';

/** Runtime type guard for ThemePreference. Used by the persistence layer. */
export function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === 'string' && (VALID_THEME_PREFERENCES as readonly string[]).includes(v);
}

/** Default view for first-time visitors. */
export const DEFAULT_VIEW: ViewId = 'detailed';

/** Default layout for first-time visitors (mockup chooses 'matrix' to preserve the canonical first paint). */
export const DEFAULT_LAYOUT: LayoutId = 'matrix';

/** Default for the "Focus on last event" toggle — on, matches the mockup. */
export const DEFAULT_FOCUS_ON_LAST_EVENT = true;

/** Type guard for runtime ViewId validation (used by the persistence layer). */
export function isViewId(v: unknown): v is ViewId {
  return typeof v === 'string' && VIEWS.some(view => view.id === v);
}

/** Type guard for runtime LayoutId validation. */
export function isLayoutId(v: unknown): v is LayoutId {
  return typeof v === 'string' && (VALID_LAYOUT_IDS as readonly string[]).includes(v);
}

/** Type guard for runtime AttrKey validation. */
export function isAttrKey(v: unknown): v is AttrKey {
  return typeof v === 'string' && (VALID_ATTR_KEYS as readonly string[]).includes(v);
}
