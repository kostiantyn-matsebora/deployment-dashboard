using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class RenameResetIdToCorrelationId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // control_stream_events: reset_id → correlation_id
            migrationBuilder.RenameColumn(
                name: "reset_id",
                table: "control_stream_events",
                newName: "correlation_id");

            // reset_cycle: reset_id → correlation_id
            migrationBuilder.RenameColumn(
                name: "reset_id",
                table: "reset_cycle",
                newName: "correlation_id");

            // component_events: partial index on correlation_id WHERE NOT NULL
            // (the column itself was added by the previous migration)
            migrationBuilder.CreateIndex(
                name: "ix_ce_correlation_id",
                table: "component_events",
                column: "correlation_id",
                filter: "correlation_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_ce_correlation_id",
                table: "component_events");

            migrationBuilder.RenameColumn(
                name: "correlation_id",
                table: "reset_cycle",
                newName: "reset_id");

            migrationBuilder.RenameColumn(
                name: "correlation_id",
                table: "control_stream_events",
                newName: "reset_id");
        }
    }
}
