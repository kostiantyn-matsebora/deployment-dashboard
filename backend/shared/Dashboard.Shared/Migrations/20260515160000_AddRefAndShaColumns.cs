using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// SAD §7 + FR-05: add two independent optional source-identifier columns
    /// to <c>deployments</c>.
    ///
    /// <list type="bullet">
    ///   <item><c>ref text NULL</c> — branch name, PR number, tag, or any
    ///   human-readable git ref. Free-form string; no length or format
    ///   constraint at this stage (stricter validation is a deferred
    ///   follow-up per SAD §10 Decision 10).</item>
    ///   <item><c>sha text NULL</c> — commit SHA. Free-form string with the
    ///   same lack of constraints.</item>
    /// </list>
    ///
    /// <para>Forward-compatibility: existing rows materialise as
    /// <c>NULL</c> in both columns — no backfill needed because the SAD
    /// treats absence and <c>null</c> as equivalent. The migration is
    /// additive only (no index, no NOT NULL constraint), so it runs without
    /// data work on Postgres and SQLite alike.</para>
    /// </summary>
    public partial class AddRefAndShaColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ref",
                table: "deployments",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "sha",
                table: "deployments",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "sha",
                table: "deployments");

            migrationBuilder.DropColumn(
                name: "ref",
                table: "deployments");
        }
    }
}
