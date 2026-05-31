using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class ResetCycleTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "reset_id",
                table: "control_stream_events",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "reset_cycle",
                columns: table => new
                {
                    id = table.Column<short>(type: "smallint", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    reset_id = table.Column<Guid>(type: "uuid", nullable: true),
                    expected_components = table.Column<string[]>(type: "text[]", nullable: true),
                    acks_received = table.Column<string[]>(type: "text[]", nullable: true),
                    started_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true),
                    deadline_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_reset_cycle", x => x.id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "reset_cycle");

            migrationBuilder.DropColumn(
                name: "reset_id",
                table: "control_stream_events");
        }
    }
}
