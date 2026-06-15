import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, FunnelChart, PieChart, HeatmapChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Register only the ECharts components used by the Analytics view (tree-shaking).
// Done here (not app.config.ts) so echarts stays in the lazy analytics chunk.
echarts.use([
  BarChart, LineChart, FunnelChart, PieChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
// Use EChartsOption from the core tree-shaken API to avoid strict type conflicts
// with formatter callback overloads in the full echarts type definitions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EChartsOption = Record<string, any>;

import { DeploymentApiService } from '../../core/services/deployment-api.service';
import { ThemeService } from '../../core/services/theme.service';
import {
  ANALYTICS_PERIODS,
  AnalyticsPeriod,
  AnalyticsDora,
  AnalyticsFrequency,
  AnalyticsChangeFailureRate,
  AnalyticsDurationHistogram,
  AnalyticsPromotionFunnel,
  AnalyticsStatusDistribution,
  AnalyticsHeatmap,
  AnalyticsTopDeployers,
  AnalyticsIncidents,
  AnalyticsWindow,
  AnalyticsIncident,
  AnalyticsKpiUnit,
} from '../../core/models/deployment.model';

// ── Status palette — shared with rest of the dashboard ───────────────────────
const STATUS_COLORS: Record<string, string> = {
  'in-progress': '#f59e0b',
  'success':     '#10b981',
  'failure':     '#ef4444',
  'pending':     '#94a3b8',
  'queued':      '#3b82f6',
  'waiting':     '#8b5cf6',
  'cancelled':   '#6b7280',
  'rejected':    '#f43f5e',
};

// MTTR duration-bucket colours — matches mockup anRenderMttr buckets:
//   <45 min → emerald, 45–90 min → amber, >90 min → coral.
// severity enum is not used for colour; duration is the axis.
const MTTR_BUCKET_COLORS = {
  fast:   '#10b981', // <45 min
  medium: '#f59e0b', // 45–90 min
  slow:   '#ef4444', // >90 min
} as const;

/** Return the MTTR marker colour keyed on duration bucket, not severity. */
function mttrColor(durationMinutes: number | null): string {
  if (durationMinutes === null) return MTTR_BUCKET_COLORS.slow; // unresolved = worst
  if (durationMinutes < 45)   return MTTR_BUCKET_COLORS.fast;
  if (durationMinutes <= 90)  return MTTR_BUCKET_COLORS.medium;
  return MTTR_BUCKET_COLORS.slow;
}

// Days of week labels for heatmap
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Resolved design-token palette for ECharts.
 * ECharts renders to <canvas> and cannot resolve CSS custom properties,
 * so we read the computed values from the live DOM after each theme change.
 */
interface ChartPalette {
  ink0:      string;
  ink1:      string;
  ink2:      string;
  glassEdge: string;
  chipBg:    string;
}

/** Read resolved token values from the document root after the theme is applied. */
function resolveChartPalette(): ChartPalette {
  const style = getComputedStyle(document.documentElement);
  return {
    ink0:      style.getPropertyValue('--ink-0').trim()        || '#e9ecf4',
    ink1:      style.getPropertyValue('--ink-1').trim()        || '#b8bdcc',
    ink2:      style.getPropertyValue('--ink-2').trim()        || '#7c829a',
    glassEdge: style.getPropertyValue('--glass-edge').trim()   || 'rgba(255,255,255,0.06)',
    chipBg:    style.getPropertyValue('--glass-strong').trim() || 'rgba(28,33,48,0.70)',
  };
}

/**
 * AnalyticsComponent — DORA-anchored deployment analytics view.
 *
 * Spec: docs/design/mockup/index.html #view-analytics (.an-* classes)
 * Contract: docs/api/openapi.yaml — tag: analytics (9 endpoints)
 * Issue: #299
 *
 * Layout (12-column grid, mirrors mockup):
 *   Row 1: frequency (span-8) | status donut (span-4)
 *   Row 2: CFR trend (span-6) | duration histogram (span-6)
 *   Row 3: promotion funnel (span-4) | deploy heatmap (span-8)
 *   Row 4: top deployers (span-6) | MTTR incidents (span-6)
 *
 * One HTTP call per endpoint; re-fetched on period change.
 * Read-only: no secrets, GET only; no client-side aggregation.
 */
@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [NgxEchartsDirective],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideEchartsCore({ echarts })],
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  private readonly api          = inject(DeploymentApiService);
  private readonly themeService = inject(ThemeService);

  // ── Period selector ──────────────────────────────────────
  protected readonly periods = ANALYTICS_PERIODS;
  protected readonly activePeriod = signal<AnalyticsPeriod>('14d');

  // ── Loading state — counter cleared only when all 9 requests have resolved ──
  // Each fetch() increments by 9; each settled request decrements by 1.
  private loadingCount = signal(0);
  protected readonly loading = computed(() => this.loadingCount() > 0);

  // ── Raw response signals ─────────────────────────────────
  protected readonly dora              = signal<AnalyticsDora | null>(null);
  protected readonly frequency         = signal<AnalyticsFrequency | null>(null);
  protected readonly cfr               = signal<AnalyticsChangeFailureRate | null>(null);
  protected readonly durationHistogram = signal<AnalyticsDurationHistogram | null>(null);
  protected readonly funnel            = signal<AnalyticsPromotionFunnel | null>(null);
  protected readonly statusDist        = signal<AnalyticsStatusDistribution | null>(null);
  protected readonly heatmap           = signal<AnalyticsHeatmap | null>(null);
  protected readonly topDeployers      = signal<AnalyticsTopDeployers | null>(null);
  protected readonly incidents         = signal<AnalyticsIncidents | null>(null);

  // ── Resolved chart palette — recomputed on theme change ──────────────────
  // ThemeService.theme() is the reactive dependency; resolving from getComputedStyle
  // after the effect has applied [data-theme] to <html> gives the correct token values
  // for both explicit themes and auto (which applies light tokens via media query).
  protected readonly chartPalette = signal<ChartPalette>(resolveChartPalette());

  // ── Window subtitle (from any response) ─────────────────
  protected readonly resolvedWindow = computed<AnalyticsWindow | null>(() => {
    return this.dora()?.window ?? this.frequency()?.window ?? null;
  });

  protected readonly subtitleText = computed(() => {
    const w = this.resolvedWindow();
    if (!w) return '';
    // Retention clause is only meaningful when the window was actually clamped.
    const retention = w.clamped ? ` — clamped to retention (${w.retention_days}d)` : '';
    return `${w.days} days${retention}`;
  });

  // ── DORA KPI band ────────────────────────────────────────
  protected readonly doraKpis = computed(() => {
    const d = this.dora();
    if (!d) return [];
    return [
      {
        key:   'deployment_frequency',
        label: 'Deploy Frequency',
        kpi:   d.deployment_frequency,
        higherIsBetter: true,
      },
      {
        key:   'lead_time',
        label: 'Lead Time',
        kpi:   d.lead_time,
        higherIsBetter: false,
        approx: true,
      },
      {
        key:   'change_failure_rate',
        label: 'Change Failure Rate',
        kpi:   d.change_failure_rate,
        higherIsBetter: false,
      },
      {
        key:   'time_to_restore',
        label: 'Time to Restore',
        kpi:   d.time_to_restore,
        higherIsBetter: false,
      },
    ];
  });

  // ── Chart options (computed from signals) ────────────────

  protected readonly freqChartOption = computed<EChartsOption | null>(() => {
    const f = this.frequency();
    if (!f) return null;
    const p = this.chartPalette();
    const dates = f.buckets.map(b => b.date);
    return {
      tooltip:  { trigger: 'axis', axisPointer: { type: 'shadow' } },
      // Fix #2: move legend to top so it doesn't collide with the x-axis date labels.
      legend:   { data: ['Success', 'Failure'], textStyle: { color: p.ink2 }, top: 0 },
      // Fix #2: increase top to leave room for the top legend; bottom stays for x-axis labels.
      grid:     { left: 40, right: 8, top: 28, bottom: 28 },
      xAxis:    { type: 'category', data: dates, axisLabel: { color: p.ink2, fontSize: 10 }, axisLine: { lineStyle: { color: p.glassEdge } } },
      yAxis:    { type: 'value', axisLabel: { color: p.ink2, fontSize: 10 }, splitLine: { lineStyle: { color: p.glassEdge } } },
      series: [
        {
          name: 'Success',
          type: 'bar',
          stack: 'total',
          data: f.buckets.map(b => b.success),
          itemStyle: { color: STATUS_COLORS['success'] },
        },
        {
          name: 'Failure',
          type: 'bar',
          stack: 'total',
          data: f.buckets.map(b => b.failure),
          itemStyle: { color: STATUS_COLORS['failure'] },
        },
      ],
    };
  });

  protected readonly cfrChartOption = computed<EChartsOption | null>(() => {
    const c = this.cfr();
    if (!c) return null;
    const p = this.chartPalette();
    const dates = c.buckets.map(b => b.date);
    return {
      tooltip:  { trigger: 'axis' },
      grid:     { left: 40, right: 8, top: 8, bottom: 24 },
      xAxis:    { type: 'category', data: dates, axisLabel: { color: p.ink2, fontSize: 10 }, axisLine: { lineStyle: { color: p.glassEdge } } },
      yAxis:    {
        type: 'value',
        min: 0,
        max: 1,
        axisLabel: { color: p.ink2, fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` },
        splitLine: { lineStyle: { color: p.glassEdge } },
      },
      series: [
        {
          name: 'CFR',
          type: 'line',
          data: c.buckets.map(b => b.rate),
          smooth: true,
          lineStyle: { color: STATUS_COLORS['failure'] },
          itemStyle: { color: STATUS_COLORS['failure'] },
          areaStyle: { color: 'rgba(239,68,68,0.12)' },
          markLine: {
            silent: true,
            lineStyle: { type: 'dashed', color: '#10b981', width: 1.5 },
            label: { formatter: '15% Elite', color: '#10b981', fontSize: 10 },
            data: [{ yAxis: c.elite_threshold }],
          },
        },
      ],
    };
  });

  protected readonly durationChartOption = computed<EChartsOption | null>(() => {
    const h = this.durationHistogram();
    if (!h) return null;
    const p = this.chartPalette();
    const labels = h.bins.map(b => b.label);

    // Shared markLine style — clean dashed line, no arrowheads.
    // rotate:0 forces horizontal text (vertical markLines inherit 90° by default).
    // position:'end' places the label ABOVE the plot top, inside the grid.top band
    // (46px) that bars never reach — guarantees the chip is always fully visible
    // regardless of bar height. offset:[4,0] nudges 4px right of the line.
    const markLineBase = {
      lineStyle: { type: 'dashed' as const, width: 1.5 },
      label:     { fontSize: 13, fontWeight: 500, rotate: 0, position: 'end' as const,
                   offset: [4, 0] as [number, number],
                   backgroundColor: p.chipBg, padding: [2, 4] as [number, number] },
    };

    const marks: object[] = [];

    if (h.p50_minutes != null) {
      const p50Bin = this.closestBinLabel(h.bins, h.p50_minutes);
      const p95Bin = h.p95_minutes != null ? this.closestBinLabel(h.bins, h.p95_minutes) : null;

      if (p95Bin !== null && p95Bin === p50Bin) {
        // Same bin: one combined marker — both percentiles represented, neutral indigo color.
        marks.push({
          xAxis:     p50Bin,
          lineStyle: { ...markLineBase.lineStyle, color: '#6366f1' },
          label:     { ...markLineBase.label, formatter: 'p50 · p95', color: '#6366f1' },
        });
      } else {
        // Different bins: individual markers, p50 emerald / p95 amber.
        marks.push({
          xAxis:     p50Bin,
          lineStyle: { ...markLineBase.lineStyle, color: '#10b981' },
          label:     { ...markLineBase.label, formatter: 'p50', color: '#10b981' },
        });
        if (p95Bin !== null) {
          marks.push({
            xAxis:     p95Bin,
            lineStyle: { ...markLineBase.lineStyle, color: '#f59e0b' },
            label:     { ...markLineBase.label, formatter: 'p95', color: '#f59e0b' },
          });
        }
      }
    } else if (h.p95_minutes != null) {
      const p95Bin = this.closestBinLabel(h.bins, h.p95_minutes);
      marks.push({
        xAxis:     p95Bin,
        lineStyle: { ...markLineBase.lineStyle, color: '#f59e0b' },
        label:     { ...markLineBase.label, formatter: 'p95', color: '#f59e0b' },
      });
    }

    return {
      tooltip:  { trigger: 'axis', axisPointer: { type: 'shadow' } },
      // grid.top:46 — clear horizontal band above the plot for 'end'-positioned labels.
      // Bars are confined to the plot area below this band, so labels never overlap bars.
      grid:     { left: 40, right: 8, top: 46, bottom: 24 },
      xAxis:    { type: 'category', data: labels, axisLabel: { color: p.ink2, fontSize: 10 }, axisLine: { lineStyle: { color: p.glassEdge } } },
      yAxis:    { type: 'value', axisLabel: { color: p.ink2, fontSize: 10 }, splitLine: { lineStyle: { color: p.glassEdge } } },
      series: [
        {
          name: 'Deployments',
          type: 'bar',
          data: h.bins.map(b => b.count),
          itemStyle: { color: '#6366f1' },
          // symbol at the container level reliably suppresses arrowheads on all data items.
          markLine: marks.length ? { silent: true, symbol: ['none', 'none'], data: marks } : undefined,
        },
      ],
    };
  });

  protected readonly funnelChartOption = computed<EChartsOption | null>(() => {
    const f = this.funnel();
    if (!f || !f.stages.length) return null;
    return {
      tooltip:  { trigger: 'item' },
      series: [
        {
          type: 'funnel',
          left: '10%',
          width: '80%',
          top: 8,
          bottom: 8,
          minSize: '20%',
          maxSize: '100%',
          sort: 'none',
          gap: 4,
          label: {
            show: true,
            position: 'inside',
            formatter: (params: { name: string; value: number }) => `${params.name}: ${params.value}`,
            color: '#fff',
            fontSize: 11,
          },
          data: f.stages.map(s => ({ name: s.environment, value: s.count })),
          itemStyle: { borderWidth: 0 },
          color: ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
        },
      ],
    };
  });

  protected readonly donutChartOption = computed<EChartsOption | null>(() => {
    const d = this.statusDist();
    if (!d) return null;
    const p = this.chartPalette();
    const total = d.statuses.reduce((sum, s) => sum + s.count, 0);
    const nonZero = d.statuses.filter(s => s.count > 0);
    if (!nonZero.length) return null;
    return {
      // Task 4: appendToBody prevents the tooltip being clipped by .an-card overflow:hidden.
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (params: { name: string; value: number; percent: number }) => `${params.name}: ${params.value} (${params.percent}%)`,
      },
      legend: { show: false },
      series: [
        {
          type: 'pie',
          radius: ['38%', '68%'],
          center: ['35%', '50%'],
          // Task 5: minAngle ensures tiny slices (e.g. 1 of 2800) are still visible.
          // Slight angular distortion on small slices is intentional (user decision).
          minAngle: 6,
          data: d.statuses.map(s => ({
            name:  s.status,
            value: s.count,
            itemStyle: { color: STATUS_COLORS[s.status] ?? '#94a3b8' },
          })),
          label: { show: false },
          labelLine: { show: false },
          emphasis: { itemStyle: { shadowBlur: 8, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.4)' } },
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: String(total),
            font: '600 18px JetBrains Mono',
            fill: p.ink0,
            textAlign: 'center',
          },
          // Offset to centre label inside the donut left-side
          x: -10,
        },
      ],
    };
  });

  // Legend rows for the donut (rendered in HTML alongside the chart).
  // Filtered to non-zero counts to match the pie series (which also only renders
  // non-zero slices); prevents legend rows with a dot but no corresponding slice.
  // pct is computed from the full total so percentages remain consistent.
  protected readonly donutLegend = computed(() => {
    const d = this.statusDist();
    if (!d) return [];
    const total = d.statuses.reduce((sum, s) => sum + s.count, 0);
    return d.statuses.filter(s => s.count > 0).map(s => ({
      status: s.status,
      count:  s.count,
      pct:    total > 0 ? Math.round((s.count / total) * 100) : 0,
      color:  STATUS_COLORS[s.status] ?? '#94a3b8',
    }));
  });

  protected readonly heatmapChartOption = computed<EChartsOption | null>(() => {
    const h = this.heatmap();
    if (!h) return null;
    const p = this.chartPalette();
    // Build 7×24 grid from sparse cells
    const data: [number, number, number][] = [];
    for (const cell of h.cells) {
      data.push([cell.hour, cell.day_of_week, cell.count]);
    }
    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
    return {
      tooltip: { position: 'top', formatter: (params: { value: [number, number, number] }) => `${DOW_LABELS[params.value[1]]} ${String(params.value[0]).padStart(2,'0')}:00 — ${params.value[2]} deploys` },
      // Task 1: visualMap.show:false removes the slider that was rendering below the x-axis.
      // inRange kept so cells still shade by intensity. grid.bottom reduced to 24 (axis labels only).
      grid:    { top: 8, bottom: 24, left: 40, right: 30, containLabel: false },
      xAxis: {
        type:      'category',
        data:      hours,
        splitArea: { show: true },
        axisLabel: { color: p.ink2, fontSize: 9, interval: 2 },
        axisLine: { lineStyle: { color: p.glassEdge } },
      },
      yAxis: {
        type:      'category',
        data:      DOW_LABELS,
        splitArea: { show: true },
        axisLabel: { color: p.ink2, fontSize: 10 },
        axisLine: { lineStyle: { color: p.glassEdge } },
      },
      visualMap: {
        show: false,
        min: 0,
        max: Math.max(1, ...h.cells.map(c => c.count)),
        inRange: { color: ['rgba(99,102,241,0.1)', '#6366f1'] },
      },
      series: [
        {
          type:       'heatmap',
          data,
          label:      { show: false },
          emphasis:   { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.5)' } },
        },
      ],
    };
  });

  protected readonly topDeployersChartOption = computed<EChartsOption | null>(() => {
    const t = this.topDeployers();
    if (!t || !t.deployers.length) return null;
    const p = this.chartPalette();
    const sorted = [...t.deployers].reverse(); // ascending for horizontal bar (echarts bottom → top)
    return {
      tooltip:  { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid:     { left: 8, right: 40, top: 4, bottom: 4, containLabel: true },
      xAxis:    { type: 'value', axisLabel: { color: p.ink2, fontSize: 10 }, splitLine: { lineStyle: { color: p.glassEdge } } },
      yAxis:    { type: 'category', data: sorted.map(d => d.actor), axisLabel: { color: p.ink1, fontSize: 11 }, axisLine: { lineStyle: { color: p.glassEdge } } },
      series: [
        {
          type: 'bar',
          data: sorted.map(d => d.count),
          itemStyle: { color: '#6366f1', borderRadius: [0, 3, 3, 0] },
          // Fix #4: use resolved ink-2 token value for bar labels.
          label: { show: true, position: 'right', color: p.ink2, fontSize: 10 },
        },
      ],
    };
  });

  // ── Incidents list (rendered in HTML as a table, not echarts) ────────────
  protected readonly incidentsList = computed(() => {
    return this.incidents()?.incidents ?? [];
  });

  private subs: Subscription[] = [];

  constructor() {
    // Fix #4: re-resolve chart palette whenever the theme signal changes.
    // ThemeService sets [data-theme] on <html> synchronously in its own constructor
    // effect, which runs before this one (root-provided service is created first).
    // Reading getComputedStyle here therefore always reflects the current theme.
    effect(() => {
      // Read the theme signal to establish the reactive dependency.
      this.themeService.theme();
      this.chartPalette.set(resolveChartPalette());
    });
  }

  ngOnInit(): void {
    this.fetch(this.activePeriod());
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  protected selectPeriod(p: AnalyticsPeriod): void {
    if (p === this.activePeriod()) return;
    this.activePeriod.set(p);
    this.fetch(p);
  }

  // ── Formatting helpers ───────────────────────────────────

  protected formatKpiValue(kpi: ReturnType<typeof this.doraKpis>[number]['kpi']): string {
    if (kpi.value === null) return '—';
    const v = kpi.value;
    const unit: AnalyticsKpiUnit = kpi.unit;
    switch (unit) {
      case 'per_day': return v.toFixed(1);
      case 'hours':   return v.toFixed(1) + ' h';
      case 'ratio':   return (v * 100).toFixed(1) + '%';
      case 'minutes': return v.toFixed(0) + ' min';
      default: {
        // Exhaustiveness guard — TypeScript will error if a new unit is added to
        // AnalyticsKpiUnit without a matching case above.
        const _: never = unit;
        return String(_);
      }
    }
  }

  protected trendLabel(kpi: ReturnType<typeof this.doraKpis>[number]['kpi']): string {
    if (kpi.trend_delta === null) return '';
    const pct = Math.round(Math.abs(kpi.trend_delta) * 100);
    const dir  = kpi.trend_delta > 0 ? '▲' : '▼';
    return `${dir} ${pct}%`;
  }

  protected trendClass(kpi: ReturnType<typeof this.doraKpis>[number]['kpi'], higherIsBetter: boolean): string {
    if (kpi.trend_delta === null) return 'flat';
    const up    = kpi.trend_delta > 0;
    const good  = higherIsBetter ? up : !up;
    return good ? 'good' : 'bad';
  }

  // Task 6: color by duration bucket (<45m/45-90m/>90m), not by severity enum.
  // Matches mockup anRenderMttr colour logic. Unresolved incidents (null duration)
  // are treated as worst-case (slow/coral) — they are still open.
  protected severityColor(inc: AnalyticsIncident): string {
    return mttrColor(inc.duration_minutes);
  }

  protected formatDuration(mins: number | null): string {
    if (mins === null) return '—';
    if (mins < 60)  return `${Math.round(mins)} min`;
    return `${(mins / 60).toFixed(1)} h`;
  }

  protected formatDateTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  /** Generate a compact inline SVG sparkline for a KPI. */
  protected sparklinePath(values: number[]): string {
    if (!values.length) return '';
    const w = 80, h = 26, pad = 2;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1 || 1)) * (w - pad * 2);
      const y = (h - pad) - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    });
    return `M ${pts.join(' L ')}`;
  }

  // ── Private helpers ──────────────────────────────────────

  private fetch(period: AnalyticsPeriod): void {
    // Cancel previous in-flight requests
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];

    // Track all 9 in-flight requests; loading clears only when every one has settled.
    const REQUESTS = 9;
    this.loadingCount.set(REQUESTS);
    const done = () => this.loadingCount.update(n => Math.max(0, n - 1));

    // Fire all 9 requests independently; each updates its own signal on arrival.
    // No combineLatest — partial results render as they arrive.
    this.subs.push(
      this.api.getAnalyticsDora(period).subscribe({
        next:  v => { this.dora.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsFrequency(period).subscribe({
        next:  v => { this.frequency.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsChangeFailureRate(period).subscribe({
        next:  v => { this.cfr.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsDurationHistogram(period).subscribe({
        next:  v => { this.durationHistogram.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsPromotionFunnel(period).subscribe({
        next:  v => { this.funnel.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsStatusDistribution(period).subscribe({
        next:  v => { this.statusDist.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsHeatmap(period).subscribe({
        next:  v => { this.heatmap.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsTopDeployers(period).subscribe({
        next:  v => { this.topDeployers.set(v); done(); },
        error: () => done(),
      }),
      this.api.getAnalyticsIncidents(period).subscribe({
        next:  v => { this.incidents.set(v); done(); },
        error: () => done(),
      }),
    );
  }

  /** Find the label of the first bin whose upper bound exceeds the given minutes value (upper_minutes is exclusive). */
  private closestBinLabel(bins: AnalyticsDurationHistogram['bins'], minutes: number): string {
    for (const bin of bins) {
      if (bin.upper_minutes === null || minutes < bin.upper_minutes) return bin.label;
    }
    return bins.at(-1)?.label ?? '';
  }
}
