FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .
RUN dotnet restore fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj
RUN dotnet publish fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Dashboard.Fetcher.Host.dll"]
