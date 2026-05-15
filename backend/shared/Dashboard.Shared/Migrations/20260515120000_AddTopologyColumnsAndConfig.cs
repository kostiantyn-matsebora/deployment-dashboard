using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// SAD §5 + §7: add the topology contract to the schema.
    ///
    /// <list type="bullet">
    ///   <item><c>deployment_id text NOT NULL</c> — CI/CD-side identifier
    ///   (deduplication key + referent for <c>parent_deployments</c>).</item>
    ///   <item><c>parent_deployments text[] NOT NULL DEFAULT '{}'::text[]</c>
    ///   — explicit upstream references. Migration backfills an empty array
    ///   on every existing row so the column is never NULL on the wire.</item>
    ///   <item><c>UNIQUE INDEX (service, deployment_id)</c> — enforces SAD
    ///   "Topology constraints" point 2 and is required for <c>409 Conflict</c>.</item>
    ///   <item><c>topology_config</c> single-row table — persists the active
    ///   <c>CorrelationAttribute</c> and <c>PerServiceOverrides</c> across
    ///   restarts (SAD §7 "Configuration — Read API topology").</item>
    /// </list>
    ///
    /// <para>Backfill strategy for existing rows: <c>deployment_id</c>
    /// inherits a synthetic value derived from the surrogate id
    /// (<c>'legacy-' || id</c>) so the unique constraint can be added in
    /// the same migration without manual data work. New rows always supply
    /// a real id from CI/CD.</para>
    /// </summary>
    public partial class AddTopologyColumnsAndConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. parent_deployments: text[] with default '{}' so existing
            //    rows materialise as empty arrays (no NULLs on the wire).
            migrationBuilder.AddColumn<string[]>(
                name: "parent_deployments",
                table: "deployments",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            // 2. deployment_id: add nullable first, backfill, then enforce NOT NULL.
            //    Single migration so a fresh deploy is atomic. The backfill
            //    formula ('legacy-' || id::text) is deterministic and unique
            //    by construction, so the unique index below can be added in
            //    the same step.
            migrationBuilder.AddColumn<string>(
                name: "deployment_id",
                table: "deployments",
                type: "text",
                nullable: true);

            migrationBuilder.Sql(
                "UPDATE deployments SET deployment_id = 'legacy-' || id::text " +
                "WHERE deployment_id IS NULL;");

            migrationBuilder.AlterColumn<string>(
                name: "deployment_id",
                table: "deployments",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            // 3. UNIQUE (service, deployment_id) — enforces SAD topology
            //    constraint "duplicate POSTs are rejected with 409 Conflict".
            migrationBuilder.CreateIndex(
                name: "ux_deployments_service_deployment_id",
                table: "deployments",
                columns: new[] { "service", "deployment_id" },
                unique: true);

            // 4. Single-row table for the persisted topology config.
            migrationBuilder.CreateTable(
                name: "topology_config",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false),
                    correlation_attribute = table.Column<string>(type: "text", nullable: false),
                    per_service_overrides = table.Column<string>(type: "jsonb", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_topology_config", x => x.id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "topology_config");

            migrationBuilder.DropIndex(
                name: "ux_deployments_service_deployment_id",
                table: "deployments");

            migrationBuilder.DropColumn(
                name: "deployment_id",
                table: "deployments");

            migrationBuilder.DropColumn(
                name: "parent_deployments",
                table: "deployments");
        }
    }
}
