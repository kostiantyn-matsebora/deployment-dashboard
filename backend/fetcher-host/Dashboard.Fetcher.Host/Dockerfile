FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .
RUN dotnet restore fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj
RUN dotnet publish fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
# curl for the container HEALTHCHECK (GET /health) — the aspnet image ships
# without it (the api image installs it the same way).
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Dashboard.Fetcher.Host.dll"]
