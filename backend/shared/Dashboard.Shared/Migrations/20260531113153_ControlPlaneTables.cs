using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class ControlPlaneTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "component_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    component_id = table.Column<string>(type: "text", nullable: false),
                    event_type = table.Column<string>(type: "text", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    detail = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_component_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "control_stream_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "text", nullable: false),
                    component = table.Column<string>(type: "text", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_control_stream_events", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ce_component_received_id",
                table: "component_events",
                columns: new[] { "component_id", "received_at", "id" },
                descending: new[] { false, true, true });

            migrationBuilder.CreateIndex(
                name: "ix_ce_received_id",
                table: "component_events",
                columns: new[] { "received_at", "id" },
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "ix_cse_component_id",
                table: "control_stream_events",
                columns: new[] { "component", "id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "component_events");

            migrationBuilder.DropTable(
                name: "control_stream_events");
        }
    }
}
