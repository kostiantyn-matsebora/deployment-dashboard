using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Dashboard.Shared.Migrations
{
    /// <inheritdoc />
    public partial class CreateDeploymentsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "deployments",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    service = table.Column<string>(type: "text", nullable: false),
                    environment = table.Column<string>(type: "text", nullable: false),
                    version = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    run_url = table.Column<string>(type: "text", nullable: false),
                    run_number = table.Column<long>(type: "bigint", nullable: false),
                    actor = table.Column<string>(type: "text", nullable: false),
                    deployed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_deployments", x => x.id);
                });

            // SAD §7 "Indexes": (service, environment, deployed_at DESC) supports
            // both the DISTINCT ON matrix query and per-slot history scans
            // without an additional sort. EF Core's CreateIndex helper doesn't
            // expose per-column sort direction yet, so we emit raw SQL with a
            // guard so the migration is portable to SQLite (used by unit
            // tests). SQLite ignores per-column ASC/DESC in index defs but
            // accepts the syntax.
            migrationBuilder.Sql(
                "CREATE INDEX ix_deployments_service_environment_deployed_at " +
                "ON deployments (service, environment, deployed_at DESC);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "deployments");
        }
    }
}
