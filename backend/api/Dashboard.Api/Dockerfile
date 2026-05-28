FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 8080

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

COPY ["api/Dashboard.Api/Dashboard.Api.csproj",         "api/Dashboard.Api/"]
COPY ["write-api/Dashboard.Write/Dashboard.Write.csproj", "write-api/Dashboard.Write/"]
COPY ["read-api/Dashboard.Read/Dashboard.Read.csproj",   "read-api/Dashboard.Read/"]
COPY ["shared/Dashboard.Shared/Dashboard.Shared.csproj", "shared/Dashboard.Shared/"]

RUN dotnet restore "api/Dashboard.Api/Dashboard.Api.csproj"

COPY . .

RUN dotnet build "api/Dashboard.Api/Dashboard.Api.csproj" \
    -c $BUILD_CONFIGURATION -o /app/build --no-restore

FROM build AS publish
RUN dotnet publish "api/Dashboard.Api/Dashboard.Api.csproj" \
    -c $BUILD_CONFIGURATION -o /app/publish --no-restore /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "Dashboard.Api.dll"]
