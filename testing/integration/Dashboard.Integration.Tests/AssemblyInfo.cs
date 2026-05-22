using Xunit;

// Integration tests share a single mock-gha container. Each ScenarioFixture
// loads scenario-specific mappings via WireMock's admin API into that shared
// instance. Parallel test execution would interleave mapping loads across
// scenarios -- multiple competing `GET /deployments` mappings end up active
// simultaneously, WireMock picks one of them (typically the first registered),
// and tests downstream of that race see the wrong deployments. Disable
// per-class parallelism so each ScenarioFixture has the mock-gha to itself
// for the duration of its tests.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
