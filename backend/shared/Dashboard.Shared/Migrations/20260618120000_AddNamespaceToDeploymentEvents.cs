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

            // Backfill: parse GitHub run_url `https://github.com/{owner}/{repo}/...`
            // and set namespace = {repo}.  Rows with no parseable GitHub URL stay null.
            migrationBuilder.Sql(@"
UPDATE deployment_events
SET    namespace = (regexp_match(run_url, '^https://github\.com/[^/]+/([^/]+)'))[1]
WHERE  run_url IS NOT NULL
  AND  run_url LIKE 'https://github.com/%';
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
