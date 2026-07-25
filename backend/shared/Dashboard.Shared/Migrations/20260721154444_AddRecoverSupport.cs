using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddRecoverSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "operation",
                table: "reset_cycle",
                type: "text",
                nullable: false,
                defaultValue: "reset");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "recover_since",
                table: "reset_cycle",
                type: "timestamptz",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "payload",
                table: "control_stream_events",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "operation",
                table: "reset_cycle");

            migrationBuilder.DropColumn(
                name: "recover_since",
                table: "reset_cycle");

            migrationBuilder.DropColumn(
                name: "payload",
                table: "control_stream_events");
        }
    }
}
