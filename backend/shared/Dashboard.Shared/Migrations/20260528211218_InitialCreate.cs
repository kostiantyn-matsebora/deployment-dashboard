using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "deployment_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    deployment_id = table.Column<string>(type: "text", nullable: false),
                    service = table.Column<string>(type: "text", nullable: false),
                    environment = table.Column<string>(type: "text", nullable: false),
                    version = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    status = table.Column<string>(type: "text", nullable: false),
                    happened_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false),
                    run_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    run_number = table.Column<int>(type: "integer", nullable: true),
                    actor = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    @ref = table.Column<string>(name: "ref", type: "character varying(256)", maxLength: 256, nullable: true),
                    sha = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    parent_deployments = table.Column<string[]>(type: "text[]", nullable: true),
                    progress_reporter = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_deployment_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "fetcher_state",
                columns: table => new
                {
                    adapter = table.Column<string>(type: "text", nullable: false),
                    cursor = table.Column<string>(type: "text", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fetcher_state", x => x.adapter);
                });

            migrationBuilder.CreateIndex(
                name: "ix_de_happened_id",
                table: "deployment_events",
                columns: new[] { "happened_at", "id" },
                descending: new[] { true, true });

            migrationBuilder.CreateIndex(
                name: "ix_de_service_env_happened_id",
                table: "deployment_events",
                columns: new[] { "service", "environment", "happened_at", "id" },
                descending: new[] { false, false, true, true });

            migrationBuilder.CreateIndex(
                name: "ix_de_service_env_happened_success",
                table: "deployment_events",
                columns: new[] { "service", "environment", "happened_at" },
                descending: new[] { false, false, true },
                filter: "status = 'success'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "deployment_events");

            migrationBuilder.DropTable(
                name: "fetcher_state");
        }
    }
}
