using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// CR-0009 + ADR-0004: introduce the universal pusher-attribution token
    /// and the opaque per-<c>progress_reporter</c> cursor surface in a single
    /// migration (one CR = one cohesive schema change, mirroring the
    /// precedent set by <c>20260515120000_AddTopologyColumnsAndConfig</c>).
    ///
    /// <list type="bullet">
    ///   <item><c>progress_reporter VARCHAR(64) NULL</c> on <c>deployments</c>
    ///   — persists the <c>X-Progress-Reporter</c> request header verbatim
    ///   when present on a <c>POST /api/deployments</c> call. No backfill on
    ///   existing rows; absent / null are equivalent.</item>
    ///   <item><c>fetcher_state</c> table — composite PK
    ///   <c>(progress_reporter, source_id)</c>; <c>cursor VARCHAR(4096) NOT NULL</c>
    ///   opaque blob; <c>updated_at TIMESTAMPTZ NOT NULL</c> server-stamped on
    ///   every upsert. Backend never parses the cursor (ADR-0004 Decision 2);
    ///   each fetcher owns its own cursor shape.</item>
    /// </list>
    ///
    /// <para>Rollback drops the table first, then the column.</para>
    /// </summary>
    public partial class AddProgressReporterAndFetcherState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. progress_reporter — nullable VARCHAR(64) on deployments.
            //    Length cap matches the request-header validation in
            //    Dashboard.WriteApi (per CR-0009 / CR-0008 ProblemDetails rule).
            migrationBuilder.AddColumn<string>(
                name: "progress_reporter",
                table: "deployments",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            // 2. fetcher_state — opaque cursor blob, composite-keyed by
            //    (progress_reporter, source_id) per ADR-0004 Decision 2.
            migrationBuilder.CreateTable(
                name: "fetcher_state",
                columns: table => new
                {
                    progress_reporter = table.Column<string>(
                        type: "character varying(64)",
                        maxLength: 64,
                        nullable: false),
                    source_id = table.Column<string>(
                        type: "character varying(200)",
                        maxLength: 200,
                        nullable: false),
                    cursor = table.Column<string>(
                        type: "character varying(4096)",
                        maxLength: 4096,
                        nullable: false),
                    updated_at = table.Column<DateTime>(
                        type: "timestamp with time zone",
                        nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey(
                        "PK_fetcher_state",
                        x => new { x.progress_reporter, x.source_id });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "fetcher_state");

            migrationBuilder.DropColumn(
                name: "progress_reporter",
                table: "deployments");
        }
    }
}
