# Write API container — POST /api/deployments, NOTIFY dispatch.
#
# Build context: the `backend/` directory (so `Dashboard.sln` and the
# `shared/Dashboard.Shared` project library are visible to `dotnet restore`).
# In docker-compose.yml:
#   build:
#     context: ../backend
#     dockerfile: write-api/Dockerfile
#
# Multi-stage per SAD §7. No SPA stage — that belongs to the Read API.
# Final stage based on `mcr.microsoft.com/dotnet/aspnet:10.0`; EXPOSE 8080
# per SAD §7 "Dashboard Backend → Port 8080".

# ----- Build stage --------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy only csproj files first so the restore layer caches well.
COPY shared/Dashboard.Shared/Dashboard.Shared.csproj shared/Dashboard.Shared/
COPY write-api/Dashboard.WriteApi/Dashboard.WriteApi.csproj write-api/Dashboard.WriteApi/

RUN dotnet restore write-api/Dashboard.WriteApi/Dashboard.WriteApi.csproj

# Copy the rest of the source for the projects we actually build. We
# deliberately do not COPY tests / read-api — keeps the build context lean.
COPY shared/Dashboard.Shared/ shared/Dashboard.Shared/
COPY write-api/Dashboard.WriteApi/ write-api/Dashboard.WriteApi/

RUN dotnet publish write-api/Dashboard.WriteApi/Dashboard.WriteApi.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# ----- Runtime stage ------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# Bind to 8080 inside the container (SAD §7).
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Dashboard.WriteApi.dll"]
