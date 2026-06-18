using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddNamespaceToDeploymentEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "namespace",
                table: "deployment_events",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            // Backfill: extract the repo short name from any GitHub Actions run_url by
            // matching the path segment immediately before /actions/ — works for github.com,
            // api.github.com, enterprise hosts, and local emulators alike.
            // Rows whose run_url contains no /actions/ segment stay null.
            migrationBuilder.Sql(@"
UPDATE deployment_events
SET    namespace = (regexp_match(run_url, '/([^/]+)/actions/'))[1]
WHERE  run_url IS NOT NULL
  AND  run_url LIKE '%/actions/%';
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "namespace",
                table: "deployment_events");
        }
    }
}
