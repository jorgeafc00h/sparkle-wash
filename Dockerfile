FROM node:22-alpine AS web-build
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_GOOGLE_CLIENT_ID=
RUN VITE_GOOGLE_CLIENT_ID="$VITE_GOOGLE_CLIENT_ID" npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /src
COPY backend/src/carwash-api/WebApi.csproj backend/src/carwash-api/
RUN dotnet restore backend/src/carwash-api/WebApi.csproj
COPY backend/src/carwash-api/*.cs backend/src/carwash-api/
COPY backend/contracts/v1/service-packages.json backend/contracts/v1/
RUN dotnet publish backend/src/carwash-api/WebApi.csproj --configuration Release --no-restore --output /publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=api-build /publish/ ./
COPY --from=web-build /web/dist/ ./wwwroot/
RUN mkdir /app/data && chown "$APP_UID" /app/data
LABEL org.opencontainers.image.source="https://github.com/jorgeafc00h/sparkle-wash"
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "WebApi.dll"]
