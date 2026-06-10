import { Controller, Get, Query } from '@nestjs/common';

/**
 * Mock analytics controller — fixed offline fixtures for all 9 analytics endpoints.
 * Spec: docs/api/openapi.yaml — tag: analytics (issue #299)
 *
 * All responses include an AnalyticsWindow so the SPA can render the subtitle
 * and period retention label correctly without a real backend.
 *
 * Zero-setup dev: these fixtures are always returned regardless of query params.
 */

type AnalyticsPeriod = '7d' | '14d' | '30d';

function resolvedWindow(period: AnalyticsPeriod = '14d') {
  const days = period === '7d' ? 7 : period === '14d' ? 14 : 30;
  const to   = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    days,
    from:           from.toISOString(),
    to:             to.toISOString(),
    retention_days: 365,
    clamped:        false,
  };
}

@Controller('api/analytics')
export class AnalyticsController {

  @Get('dora')
  getDora(@Query('window') w: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    const window_ = resolvedWindow(period as AnalyticsPeriod);
    return {
      window: window_,
      deployment_frequency: {
        value:          9.2,
        unit:           'per_day',
        classification: 'elite',
        trend_delta:    0.12,
        sparkline:      [7, 9, 6, 11, 8, 10, 12, 9, 11, 8, 13, 10, 9, 11],
        approximated:   false,
      },
      lead_time: {
        value:          2.1,
        unit:           'hours',
        classification: 'high',
        trend_delta:    -0.05,
        sparkline:      [3.2, 2.8, 2.5, 2.3, 2.1, 2.0, 2.1, 2.2, 2.0, 1.9, 2.1, 2.0, 2.1, 2.2],
        approximated:   true,
      },
      change_failure_rate: {
        value:          0.08,
        unit:           'ratio',
        classification: 'elite',
        trend_delta:    -0.03,
        sparkline:      [0.12, 0.10, 0.09, 0.08, 0.07, 0.09, 0.08, 0.07, 0.08, 0.09, 0.08, 0.07, 0.08, 0.08],
        approximated:   false,
      },
      time_to_restore: {
        value:          42,
        unit:           'minutes',
        classification: 'high',
        trend_delta:    null,
        sparkline:      [60, 55, 48, 42, 50, 45, 40, 38, 42, 44, 42, 41, 43, 42],
        approximated:   false,
      },
    };
  }

  @Get('frequency')
  getFrequency(@Query('window') w: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    const window_ = resolvedWindow(period as AnalyticsPeriod);
    // Generate per-day buckets for the window
    const buckets = Array.from({ length: window_.days }, (_, i) => {
      const d  = new Date(window_.from);
      d.setUTCDate(d.getUTCDate() + i);
      const date    = d.toISOString().slice(0, 10);
      const success = 5 + Math.floor(Math.sin(i) * 3 + 3);
      const failure = Math.floor(Math.abs(Math.sin(i * 0.7) * 2));
      return { date, success, failure };
    });
    return { window: window_, buckets };
  }

  @Get('change-failure-rate')
  getCfr(@Query('window') w: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    const window_ = resolvedWindow(period as AnalyticsPeriod);
    const buckets = Array.from({ length: window_.days }, (_, i) => {
      const d  = new Date(window_.from);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const rate = parseFloat((0.05 + Math.abs(Math.sin(i * 0.8)) * 0.15).toFixed(3));
      return { date, rate };
    });
    return { window: window_, elite_threshold: 0.15, buckets };
  }

  @Get('duration-histogram')
  getDurationHistogram(@Query('window') w: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    return {
      window: resolvedWindow(period as AnalyticsPeriod),
      bins: [
        { label: '0-5',   lower_minutes: 0,   upper_minutes: 5,   count: 4  },
        { label: '5-10',  lower_minutes: 5,   upper_minutes: 10,  count: 9  },
        { label: '10-20', lower_minutes: 10,  upper_minutes: 20,  count: 22 },
        { label: '20-30', lower_minutes: 20,  upper_minutes: 30,  count: 18 },
        { label: '30-60', lower_minutes: 30,  upper_minutes: 60,  count: 11 },
        { label: '60-90', lower_minutes: 60,  upper_minutes: 90,  count: 5  },
        { label: '90+',   lower_minutes: 90,  upper_minutes: null, count: 2 },
      ],
      p50_minutes: 22,
      p95_minutes: 78,
    };
  }

  @Get('promotion-funnel')
  getPromotionFunnel(@Query('window') w: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    return {
      window: resolvedWindow(period as AnalyticsPeriod),
      stages: [
        { environment: 'dev',     count: 50, conversion: 0.82 },
        { environment: 'staging', count: 41, conversion: 0.78 },
        { environment: 'qa',      count: 32, conversion: 0.90 },
        { environment: 'preprod', count: 29, conversion: 0.86 },
        { environment: 'prod',    count: 25, conversion: null },
      ],
    };
  }

  @Get('status-distribution')
  getStatusDistribution(@Query('window') w: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    return {
      window: resolvedWindow(period as AnalyticsPeriod),
      statuses: [
        { status: 'pending',     count: 3   },
        { status: 'queued',      count: 7   },
        { status: 'waiting',     count: 2   },
        { status: 'in-progress', count: 4   },
        { status: 'success',     count: 118 },
        { status: 'failure',     count: 11  },
        { status: 'cancelled',   count: 5   },
        { status: 'rejected',    count: 1   },
      ],
    };
  }

  @Get('heatmap')
  getHeatmap(@Query('window') w: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    // Realistic-looking sparse heatmap — weekday business hours
    const cells = [
      { day_of_week: 1, hour: 9,  count: 5 },
      { day_of_week: 1, hour: 10, count: 8 },
      { day_of_week: 1, hour: 14, count: 4 },
      { day_of_week: 2, hour: 10, count: 7 },
      { day_of_week: 2, hour: 11, count: 6 },
      { day_of_week: 2, hour: 15, count: 3 },
      { day_of_week: 3, hour: 9,  count: 9 },
      { day_of_week: 3, hour: 14, count: 5 },
      { day_of_week: 3, hour: 16, count: 2 },
      { day_of_week: 4, hour: 10, count: 6 },
      { day_of_week: 4, hour: 11, count: 4 },
      { day_of_week: 4, hour: 15, count: 7 },
      { day_of_week: 5, hour: 9,  count: 3 },
      { day_of_week: 5, hour: 13, count: 2 },
    ];
    return { window: resolvedWindow(period as AnalyticsPeriod), cells };
  }

  @Get('top-deployers')
  getTopDeployers(@Query('window') w: string, @Query('limit') limit: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    const allDeployers = [
      { actor: 'alice',   count: 42 },
      { actor: 'bob',     count: 28 },
      { actor: 'charlie', count: 19 },
      { actor: 'diana',   count: 17 },
      { actor: 'eve',     count: 12 },
      { actor: 'frank',   count: 8  },
      { actor: 'grace',   count: 6  },
      { actor: 'hank',    count: 5  },
      { actor: 'irene',   count: 3  },
      { actor: 'unknown', count: 2  },
    ];
    const n = Math.min(parseInt(limit ?? '10', 10) || 10, allDeployers.length);
    return {
      window:    resolvedWindow(period as AnalyticsPeriod),
      deployers: allDeployers.slice(0, n),
    };
  }

  @Get('incidents')
  getIncidents(@Query('window') w: string, @Query('limit') limit: string) {
    const period = (w === '7d' || w === '30d') ? w : '14d';
    const allIncidents = [
      {
        service:          'checkout',
        environment:      'prod',
        failed_at:        '2026-06-08T14:02:00Z',
        restored_at:      null,
        duration_minutes: null,
        severity:         'critical',
      },
      {
        service:          'auth',
        environment:      'prod',
        failed_at:        '2026-06-07T09:10:00Z',
        restored_at:      '2026-06-07T10:05:00Z',
        duration_minutes: 55,
        severity:         'medium',
      },
      {
        service:          'gateway',
        environment:      'staging',
        failed_at:        '2026-06-06T15:30:00Z',
        restored_at:      '2026-06-06T16:05:00Z',
        duration_minutes: 35,
        severity:         'low',
      },
      {
        service:          'payments',
        environment:      'prod',
        failed_at:        '2026-06-05T11:00:00Z',
        restored_at:      '2026-06-05T12:38:00Z',
        duration_minutes: 98,
        severity:         'high',
      },
      {
        service:          'notifications',
        environment:      'qa',
        failed_at:        '2026-06-04T08:45:00Z',
        restored_at:      '2026-06-04T09:00:00Z',
        duration_minutes: 15,
        severity:         'low',
      },
    ];
    const n = Math.min(parseInt(limit ?? '10', 10) || 10, allIncidents.length);
    return {
      window:    resolvedWindow(period as AnalyticsPeriod),
      incidents: allIncidents.slice(0, n),
    };
  }
}
