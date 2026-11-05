FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/src/carwash-api/WebApi.csproj backend/src/carwash-api/
RUN dotnet restore backend/src/carwash-api/WebApi.csproj
COPY backend/src/carwash-api/*.cs backend/src/carwash-api/
COPY backend/contracts/v1/service-packages.json backend/contracts/v1/
RUN dotnet publish backend/src/carwash-api/WebApi.csproj --configuration Release --no-restore --output /publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /publish/ ./
RUN mkdir /app/data && chown "$APP_UID" /app/data
LABEL org.opencontainers.image.source="https://github.com/jorgeafc00h/sparkle-wash"
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "WebApi.dll"]
