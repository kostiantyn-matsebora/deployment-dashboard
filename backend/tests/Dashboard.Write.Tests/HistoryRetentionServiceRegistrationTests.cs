using Dashboard.Write;
using Dashboard.Write.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Write.Tests;

/// <summary>
/// Confirms that <see cref="HistoryRetentionService"/> is registered as a hosted service
/// by <see cref="WriteServiceExtensions.AddWriteServices"/>.
/// </summary>
public sealed class HistoryRetentionServiceRegistrationTests
{
    [Fact]
    public void AddWriteServices_RegistersHistoryRetentionServiceAsHostedService()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddWriteServices();

        // Act: inspect registrations before building the provider so we avoid
        // attempting to resolve services that need a real DB connection string.
        var hostedServiceDescriptors = services
            .Where(sd => sd.ServiceType == typeof(IHostedService))
            .ToList();

        // Assert: at least one descriptor maps to HistoryRetentionService.
        var hasRetentionService = hostedServiceDescriptors.Any(sd =>
            sd.ImplementationType == typeof(HistoryRetentionService) ||
            // AddHostedService<T> registers via a factory in some SDK versions.
            (sd.ImplementationFactory is not null &&
             sd.ImplementationFactory
               .Method
               .ReturnType
               .IsAssignableTo(typeof(HistoryRetentionService))));

        Assert.True(
            hasRetentionService,
            "HistoryRetentionService must be registered as IHostedService by AddWriteServices().");
    }
}
