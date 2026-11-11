# SparkleWash DevHost

Local-only host for end-to-end runs of the desktop POS and iOS app. It runs the real API
(`Program.BuildApp`) with a verifier that accepts `dev:<subject>:<email>` instead of a Google ID token.
It is a separate project: the production `Dockerfile` only restores and publishes
`src/carwash-api/WebApi.csproj`, so none of this ships. It refuses to start unless
`ASPNETCORE_ENVIRONMENT=Development`.

```bash
mkdir -p /tmp/sparklewash-dev
ASPNETCORE_ENVIRONMENT=Development \
SPARKLEWASH_GOOGLE_CLIENT_ID=dev \
SPARKLEWASH_STAFF_ROLES='1001=operator;1002=admin' \
SPARKLEWASH_TENANTS_DIR=/tmp/sparklewash-dev/tenants \
SPARKLEWASH_ARRIVALS_FILE=/tmp/sparklewash-dev/arrivals.json \
SPARKLEWASH_JOBS_FILE=/tmp/sparklewash-dev/jobs.json \
SPARKLEWASH_OPERATIONS_FILE=/tmp/sparklewash-dev/operations.json \
SPARKLEWASH_DEVICES_FILE=/tmp/sparklewash-dev/devices.json \
SPARKLEWASH_DATA_FILE=/tmp/sparklewash-dev/stations.json \
SPARKLEWASH_PHOTO_DIR=/tmp/sparklewash-dev/photos \
dotnet run --project src/carwash-api.DevHost --urls http://localhost:8080
```

Sign in. `SPARKLEWASH_STAFF_ROLES` only accepts numeric subjects (like Google's), so use `dev:<digits>:<email>`:

```bash
curl -s localhost:8080/api/auth/google -H 'Content-Type: application/json' \
  -d '{"idToken":"dev:1001:op@example.com"}'   # -> { "sessionToken": "...", "role": "operator", ... }
```

Use the `sessionToken` as `Authorization: Bearer <token>`. The `SPARKLEWASH_*_FILE` variables are optional;
point them at a temp directory to keep the run isolated from `src/carwash-api/data`.

Without `SPARKLEWASH_STAFF_ROLES`, `POST /api/tenants/register` with the same kind of token creates a tenant with you as admin.
