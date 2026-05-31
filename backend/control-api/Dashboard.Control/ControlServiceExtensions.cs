using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Control.Sse;
using Dashboard.Control.Validation;
using Dashboard.Shared.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Control;

public static class ControlServiceExtensions
{
    public static IServiceCollection AddControlServices(this IServiceCollection services)
    {
        // ── Options ───────────────────────────────────────────────────────────
        services.AddOptions<ResetOptions>()
                .BindConfiguration(ResetOptions.SectionName);

        // ── Repositories + validators ─────────────────────────────────────────
        services.AddScoped<IComponentEventRepository, ComponentEventRepository>();
        services.AddScoped<IControlStreamRepository, ControlStreamRepository>();
        services.AddScoped<IResetCycleRepository, ResetCycleRepository>();
        services.AddSingleton<IComponentEventValidator, ComponentEventValidator>();

        // ── Notifiers ─────────────────────────────────────────────────────────
        services.AddScoped<IControlEventNotifier, PostgresControlEventNotifier>();
        services.AddScoped<IComponentAckNotifier, PostgresComponentAckNotifier>();
        // Fix C: state-change notifier NOTIFY reset_state on every transition.
        services.AddScoped<IResetStateNotifier, PostgresResetStateNotifier>();

        // ── Reset orchestrator (singleton — holds advisory lock per cycle) ─────
        services.AddSingleton<ResetOrchestrator>();
        services.AddSingleton<IResetOrchestrator>(sp => sp.GetRequiredService<ResetOrchestrator>());

        // ── Reset service (scoped — per-request) ──────────────────────────────
        services.AddScoped<IResetService, ResetService>();

        // ── Fix A: Reconciler background service ──────────────────────────────
        services.AddHostedService<ResetReconciler>();

        // ── Control SSE broadcaster: LISTEN control_events ────────────────────
        // One singleton serves as IControlEventBroadcaster (injected into stream handler),
        // BackgroundService (owns the LISTEN connection), and IControlReadinessIndicator.
        services.AddSingleton<ControlEventBroadcaster>();
        services.AddSingleton<IControlEventBroadcaster>(
            sp => sp.GetRequiredService<ControlEventBroadcaster>());
        services.AddSingleton<IControlReadinessIndicator>(
            sp => sp.GetRequiredService<ControlEventBroadcaster>());
        services.AddHostedService(
            sp => sp.GetRequiredService<ControlEventBroadcaster>());

        // ── Component acks broadcaster: LISTEN component_acks (third channel) ──
        services.AddSingleton<ComponentAcksBroadcaster>();
        services.AddSingleton<IAckReadinessIndicator>(
            sp => sp.GetRequiredService<ComponentAcksBroadcaster>());
        services.AddHostedService(
            sp => sp.GetRequiredService<ComponentAcksBroadcaster>());

        // ── Fix C: per-instance reset-state LISTEN listener ───────────────────
        // Seeds IsResetting from DB at startup; updates on NOTIFY reset_state.
        services.AddSingleton<ResetStateListener>();
        services.AddSingleton<IResetStateProvider>(
            sp => sp.GetRequiredService<ResetStateListener>());
        services.AddHostedService(
            sp => sp.GetRequiredService<ResetStateListener>());

        return services;
    }
}
