using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddDeploymentEventDedupKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Deduplicate existing rows before adding the unique index.
            // Keeps the row with the lowest id (earliest UUIDv7) per natural key and deletes
            // all later duplicates.  This step is NOT reversible — Down only drops the index.
            migrationBuilder.Sql(@"
DELETE FROM deployment_events
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY deployment_id, status, happened_at ORDER BY id
    ) AS rn FROM deployment_events
  ) d WHERE d.rn > 1
);
");

            migrationBuilder.CreateIndex(
                name: "ux_de_dedup_natural_key",
                table: "deployment_events",
                columns: new[] { "deployment_id", "status", "happened_at" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The dedup delete performed in Up is not reversible.
            migrationBuilder.DropIndex(
                name: "ux_de_dedup_natural_key",
                table: "deployment_events");
        }
    }
}
