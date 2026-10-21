using System.Net.WebSockets;
using System.Text.Json;

namespace CarwashApi;

public static class Program
{
    private const long MaxDemoUploadBytes = 524288;

    public static WebApplication BuildApp(string[] args, IGoogleIdentityVerifier? identityVerifier = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        var store = new StationStore(builder.Configuration["SPARKLEWASH_DATA_FILE"] ?? Path.Combine(builder.Environment.ContentRootPath, "data", "stations.json"));
        var photoStore = new PhotoStore(builder.Configuration["SPARKLEWASH_PHOTO_DIR"] ?? Path.Combine(builder.Environment.ContentRootPath, "data", "photos"),
            int.TryParse(builder.Configuration["SPARKLEWASH_PHOTO_MAX_COUNT"], out var photoCount) ? photoCount : 1000);
        var n1coInbox = new N1coWebhookInbox(builder.Configuration["SPARKLEWASH_N1CO_WEBHOOK_FILE"] ?? Path.Combine(builder.Environment.ContentRootPath, "data", "n1co-webhooks.json"));
        var arrivals = new ArrivalStore(builder.Configuration["SPARKLEWASH_ARRIVALS_FILE"] ?? Path.Combine(builder.Environment.ContentRootPath, "data", "arrivals.json"));
        var jobs = new JobStore(builder.Configuration["SPARKLEWASH_JOBS_FILE"] ?? Path.Combine(builder.Environment.ContentRootPath, "data", "jobs.json"));
        var operations = new OperationsStore(builder.Configuration["SPARKLEWASH_OPERATIONS_FILE"] ?? Path.Combine(builder.Environment.ContentRootPath, "data", "operations.json"));
        var staffAuth = new StaffAuth(builder.Configuration, identityVerifier);
        var hub = new StationHub();
        builder.Services.AddSingleton(store);
        builder.Services.AddSingleton(hub);
        builder.Services.AddSingleton<MqttBridge>();
        builder.Services.AddHostedService(provider => provider.GetRequiredService<MqttBridge>());
        // The staff console is hosted separately (Static Web Apps), so its origin must be allowed explicitly.
        var corsOrigins = (builder.Configuration["SPARKLEWASH_CORS_ORIGINS"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (corsOrigins.Length > 0)
            builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.WithOrigins(corsOrigins)
                .WithHeaders("Authorization", "Content-Type", "Idempotency-Key").WithMethods("GET", "POST", "DELETE")));
        var app = builder.Build();
        if (corsOrigins.Length > 0) app.UseCors();
        app.UseWebSockets();
        var ingestionKey = builder.Configuration["SPARKLEWASH_INGEST_KEY"];
        var streamKey = builder.Configuration["SPARKLEWASH_STREAM_KEY"];
        var n1coWebhookSecret = builder.Configuration["SPARKLEWASH_N1CO_WEBHOOK_SECRET"];
        var heartbeatSeconds = int.TryParse(builder.Configuration["SPARKLEWASH_STREAM_HEARTBEAT_SECONDS"], out var configuredHeartbeat)
            ? Math.Clamp(configuredHeartbeat, 1, 60) : 15;

        app.MapGet("/healthz", () => Results.Json(new { status = "healthy" }));
        app.MapGet("/health", () => Results.Json(new { status = "healthy" }));
        app.MapPost("/health", () => Results.Json(new { ok = true, message = "ready" }));
        app.MapGet("/api/packages", () => Results.Json(PackageCatalog.Current));
        app.MapGet("/api/packages/suggestion", (string vehicleClass) =>
        {
            var suggestion = PackageCatalog.Suggest(vehicleClass);
            return suggestion is null ? Results.BadRequest(new { error = "Unknown vehicle class" }) : Results.Json(suggestion);
        });
        app.MapPost("/api/arrivals/observations", async (HttpContext context) =>
        {
            if (!Authorized(context, ingestionKey)) return Results.Unauthorized();
            if (context.Request.ContentLength > 400000) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            using var body = new MemoryStream();
            var chunk = new byte[8192];
            int read;
            while ((read = await context.Request.Body.ReadAsync(chunk)) > 0)
            {
                if (body.Length + read > 400000) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                body.Write(chunk, 0, read);
            }
            ArrivalInput? input;
            try { input = JsonSerializer.Deserialize<ArrivalInput>(body.ToArray(), new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
            catch (JsonException) { return Results.BadRequest(new { error = "Invalid observation JSON" }); }
            if (!ArrivalStore.ValidInput(input)) return Results.BadRequest(new { error = "Invalid arrival observation" });
            byte[]? photo = null;
            if (input!.PhotoBase64 is not null)
            {
                try { photo = Convert.FromBase64String(input.PhotoBase64); }
                catch (FormatException) { return Results.BadRequest(new { error = "Invalid photo encoding" }); }
                if (photo.Length > 262144) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                if (!PhotoStore.IsJpeg(photo)) return Results.BadRequest(new { error = "Invalid JPEG photo" });
            }
            var result = await arrivals.AddAsync(input, photo, photoStore);
            if (result.Status == ArrivalAddStatus.Conflict) return Results.Conflict(new { error = "Device event ID reused with different evidence" });
            var observation = result.Observation;
            if (result.Status == ArrivalAddStatus.Created && observation.PlateCandidate is not null &&
                await jobs.FindOpenByPlateAsync(observation.PlateCandidate) is { } openJob)
                observation = await arrivals.LinkJobAsync(observation.Id, openJob.Id) ?? observation;
            return Results.Json(new { observation, duplicate = result.Status == ArrivalAddStatus.Duplicate, trackedJobId = observation.JobId },
                statusCode: result.Status == ArrivalAddStatus.Created ? StatusCodes.Status201Created : StatusCodes.Status200OK);
        });
        app.MapGet("/api/arrivals", async (HttpContext context, int? limit, bool? pending) =>
        {
            if (staffAuth.Authenticate(context.Request.Headers.Authorization) is null) return Results.Unauthorized();
            if (limit is < 1 or > 100) return Results.BadRequest(new { error = "limit must be 1 through 100" });
            var list = await arrivals.ListAsync();
            return Results.Json((pending == true ? list.Where(x => x.ConfirmedAt is null && x.JobId is null) : list).Take(limit ?? 50));
        });
        app.MapPost("/api/arrivals/{id}/confirm", async (HttpContext context, string id, ConfirmArrivalInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role is not ("operator" or "admin")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var plate = ArrivalStore.NormalizePlate(input.Plate);
            if (plate is null || PackageCatalog.Current.VehicleClasses.All(item => item.Id != input.VehicleClass))
                return Results.BadRequest(new { error = "Invalid plate or vehicle class" });
            var result = await arrivals.ConfirmAsync(id, plate, input.VehicleClass!, session.Subject);
            return result.Status switch
            {
                ArrivalConfirmStatus.NotFound => Results.NotFound(),
                ArrivalConfirmStatus.Conflict => Results.Conflict(new { error = "Arrival was already confirmed differently" }),
                _ => Results.Json(result.Observation)
            };
        });
        app.MapGet("/api/arrivals/{id}/photo", async (HttpContext context, string id) =>
        {
            if (staffAuth.Authenticate(context.Request.Headers.Authorization) is null) return Results.Unauthorized();
            var observation = (await arrivals.ListAsync()).FirstOrDefault(item => item.Id == id);
            if (observation?.PhotoId is null) return Results.NotFound();
            var bytes = await photoStore.GetAsync(observation.PhotoId);
            return bytes is null ? Results.NotFound() : Results.File(bytes, "image/jpeg");
        });
        app.MapGet("/api/jobs", async (HttpContext context, string? status, string? plate) =>
        {
            if (staffAuth.Authenticate(context.Request.Headers.Authorization) is null) return Results.Unauthorized();
            if (status is not null && status is not ("arrived" or "queued" or "in_progress" or "completed" or "cancelled"))
                return Results.BadRequest(new { error = "Invalid job status" });
            var normalizedPlate = plate is null ? null : ArrivalStore.NormalizePlate(plate);
            if (plate is not null && normalizedPlate is null) return Results.BadRequest(new { error = "Invalid plate" });
            var result = await jobs.ListAsync();
            return Results.Json(result.Where(x => (status is null || x.Status == status) && (normalizedPlate is null || x.Plate == normalizedPlate)));
        });
        app.MapGet("/api/plates/{plate}/timeline", async (HttpContext context, string plate) =>
        {
            if (staffAuth.Authenticate(context.Request.Headers.Authorization) is null) return Results.Unauthorized();
            var normalized = ArrivalStore.NormalizePlate(plate);
            if (normalized is null) return Results.BadRequest(new { error = "Invalid plate" });
            var plateJobs = (await jobs.ListAsync()).Where(x => x.Plate == normalized).ToArray();
            var sightings = (await arrivals.ListAsync())
                .Where(x => x.PlateCandidate == normalized || x.ConfirmedPlate == normalized).Take(200).ToArray();
            return Results.Json(new
            {
                plate = normalized,
                openJob = plateJobs.FirstOrDefault(x => x.Status is not ("completed" or "cancelled")),
                visits = plateJobs.Length,
                lastSeenAt = sightings.Length == 0 ? (DateTimeOffset?)null : sightings.Max(x => x.CapturedAt),
                jobs = plateJobs,
                sightings
            });
        });
        app.MapGet("/api/jobs/summary", async (HttpContext context) =>
        {
            if (staffAuth.Authenticate(context.Request.Headers.Authorization) is null) return Results.Unauthorized();
            return Results.Json(await jobs.SummaryAsync());
        });
        app.MapGet("/api/jobs/{id}", async (HttpContext context, string id) =>
        {
            if (staffAuth.Authenticate(context.Request.Headers.Authorization) is null) return Results.Unauthorized();
            var job = await jobs.GetAsync(id);
            return job is null ? Results.NotFound() : Results.Json(job);
        });
        app.MapPost("/api/jobs", async (HttpContext context, OpenJobInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role is not ("operator" or "admin")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (!ValidIdempotencyKey(context.Request.Headers["Idempotency-Key"].ToString()))
                return Results.BadRequest(new { error = "Idempotency-Key is required" });
            var arrival = (await arrivals.ListAsync()).FirstOrDefault(x => x.Id == input.ArrivalId);
            if (arrival is null) return Results.NotFound();
            if (arrival.ConfirmedAt is null) return Results.Conflict(new { error = "Arrival needs staff confirmation" });
            var service = PackageCatalog.Current.Packages.FirstOrDefault(x => x.Id == input.PackageId);
            if (service is null) return Results.BadRequest(new { error = "Unknown detailing package" });
            var result = await jobs.CreateAsync(arrival, service, context.Request.Headers["Idempotency-Key"].ToString(), session.Subject);
            if (result.Status is JobActionStatus.Created or JobActionStatus.Duplicate && result.Job is not null)
                await arrivals.LinkJobAsync(arrival.Id, result.Job.Id);
            return result.Status switch
            {
                JobActionStatus.Conflict => Results.Conflict(new { error = "Arrival or plate already has an open job, or idempotency key was reused" }),
                JobActionStatus.Duplicate => Results.Json(result.Job),
                _ => Results.Json(result.Job, statusCode: StatusCodes.Status201Created)
            };
        });
        app.MapPost("/api/jobs/{id}/transition", async (HttpContext context, string id, JobTransitionInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role is not ("operator" or "admin")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var key = context.Request.Headers["Idempotency-Key"].ToString();
            if (!ValidIdempotencyKey(key) || input.Status is not ("queued" or "in_progress" or "completed" or "cancelled"))
                return Results.BadRequest(new { error = "Valid status and Idempotency-Key are required" });
            var result = await jobs.TransitionAsync(id, input.Status, key, session.Subject);
            if (result.Status is JobActionStatus.Created or JobActionStatus.Duplicate && input.Status is "cancelled" or "completed")
                await operations.ReleaseJobAsync(id);
            return result.Status switch
            {
                JobActionStatus.NotFound => Results.NotFound(),
                JobActionStatus.Conflict => Results.Conflict(new { error = "Idempotency key reused for a different transition" }),
                JobActionStatus.InvalidTransition => Results.Conflict(new { error = "Invalid job transition" }),
                _ => Results.Json(result.Job)
            };
        });
        app.MapPost("/api/jobs/{id}/employees", async (HttpContext context, string id, AssignEmployeeInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role is not ("operator" or "admin")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var key = context.Request.Headers["Idempotency-Key"].ToString();
            if (!ValidIdempotencyKey(key)) return Results.BadRequest(new { error = "Idempotency-Key is required" });
            var employee = (await operations.EmployeesAsync()).FirstOrDefault(x => x.Id == input.EmployeeId && x.Active);
            if (employee is null) return Results.BadRequest(new { error = "Employee is unknown or inactive" });
            var result = await jobs.AssignAsync(id, employee, key);
            return result.Status switch
            {
                JobActionStatus.NotFound => Results.NotFound(),
                JobActionStatus.Conflict => Results.Conflict(new { error = "Employee is already assigned or job is closed" }),
                _ => Results.Json(result.Job)
            };
        });
        app.MapGet("/api/employees", async (HttpContext context) =>
            staffAuth.Authenticate(context.Request.Headers.Authorization) is null ? Results.Unauthorized() : Results.Json(await operations.EmployeesAsync()));
        app.MapPost("/api/employees", async (HttpContext context, EmployeeInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role != "admin") return Results.StatusCode(StatusCodes.Status403Forbidden);
            var name = input.Name?.Trim();
            if (name is null || name.Length is < 2 or > 100 || name.Any(char.IsControl))
                return Results.BadRequest(new { error = "Invalid employee name" });
            var employee = await operations.AddEmployeeAsync(name);
            return employee is null ? Results.Conflict(new { error = "Active employee name already exists" }) :
                Results.Json(employee, statusCode: StatusCodes.Status201Created);
        });
        app.MapPost("/api/employees/{id}/status", async (HttpContext context, string id, EmployeeStatusInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role != "admin") return Results.StatusCode(StatusCodes.Status403Forbidden);
            var employee = await operations.SetEmployeeActiveAsync(id, input.Active);
            return employee is null ? Results.NotFound() : Results.Json(employee);
        });
        app.MapGet("/api/inventory/items", async (HttpContext context) =>
            staffAuth.Authenticate(context.Request.Headers.Authorization) is null ? Results.Unauthorized() : Results.Json(await operations.ItemsAsync()));
        app.MapPost("/api/inventory/items", async (HttpContext context, InventoryItemInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role != "admin") return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (input.Sku is null || input.Sku.Length is < 2 or > 64 ||
                !input.Sku.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ||
                string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 100 || input.Name.Any(char.IsControl) ||
                input.Unit is not ("ml" or "l" or "g" or "kg" or "each") || input.ReorderPoint is < 0 or > 1000000)
                return Results.BadRequest(new { error = "Invalid inventory item" });
            var item = await operations.AddItemAsync(input);
            return item is null ? Results.Conflict(new { error = "SKU already exists" }) :
                Results.Json(item, statusCode: StatusCodes.Status201Created);
        });
        app.MapGet("/api/inventory/items/{id}/movements", async (HttpContext context, string id) =>
            staffAuth.Authenticate(context.Request.Headers.Authorization) is null ? Results.Unauthorized() : Results.Json(await operations.MovementsAsync(itemId: id)));
        app.MapGet("/api/jobs/{id}/materials", async (HttpContext context, string id) =>
            staffAuth.Authenticate(context.Request.Headers.Authorization) is null ? Results.Unauthorized() : Results.Json(await operations.MovementsAsync(jobId: id)));
        app.MapPost("/api/inventory/items/{id}/movements", async (HttpContext context, string id, StockMovementInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role is not ("operator" or "admin")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (input.Type is ("receipt" or "adjustment") && session.Role != "admin")
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            var key = context.Request.Headers["Idempotency-Key"].ToString();
            if (!ValidIdempotencyKey(key) || input.Type is not ("receipt" or "adjustment" or "consume") ||
                input.Quantity is < -1000000 or > 1000000 or 0 ||
                input.Type is not "adjustment" && input.Quantity < 0 ||
                string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 200)
                return Results.BadRequest(new { error = "Invalid stock movement" });
            var replay = await operations.MovementByKeyAsync(key);
            if (replay is not null)
            {
                var delta = input.Type == "adjustment" ? input.Quantity : input.Type == "receipt" ? input.Quantity : -input.Quantity;
                return replay.ItemId == id && replay.Type == input.Type && replay.Delta == delta &&
                    replay.JobId == input.JobId && replay.EmployeeId == input.EmployeeId && replay.Reason == input.Reason
                    ? Results.Json(replay) : Results.Conflict(new { error = "Idempotency key reused with different movement" });
            }
            if (input.Type == "consume")
            {
                var job = input.JobId is null ? null : await jobs.GetAsync(input.JobId);
                if (job?.Status != "in_progress" || input.EmployeeId is null ||
                    !job.Assignments.Any(x => x.EmployeeId == input.EmployeeId))
                    return Results.Conflict(new { error = "Consumption requires an in-progress job and assigned employee" });
            }
            else if (input.JobId is not null || input.EmployeeId is not null)
                return Results.BadRequest(new { error = "Only job consumption may include job and employee IDs" });
            var result = await operations.MoveAsync(id, input, key, session.Subject);
            return result.Status switch
            {
                StockActionStatus.NotFound => Results.NotFound(),
                StockActionStatus.Conflict => Results.Conflict(new { error = "Idempotency key reused with different movement" }),
                StockActionStatus.Insufficient => Results.Conflict(new { error = "Insufficient available stock" }),
                StockActionStatus.Duplicate => Results.Json(result.Value),
                _ => Results.Json(result.Value, statusCode: StatusCodes.Status201Created)
            };
        });
        app.MapPost("/api/inventory/items/{id}/reservations", async (HttpContext context, string id, StockReservationInput input) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            if (session is null) return Results.Unauthorized();
            if (session.Role is not ("operator" or "admin")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var key = context.Request.Headers["Idempotency-Key"].ToString();
            if (!ValidIdempotencyKey(key) || input.Quantity is <= 0 or > 1000000 || input.JobId is null)
                return Results.BadRequest(new { error = "Invalid stock reservation" });
            var replay = await operations.ReservationByKeyAsync(key);
            if (replay is not null)
                return replay.ItemId == id && replay.JobId == input.JobId && replay.Quantity == input.Quantity
                    ? Results.Json(replay) : Results.Conflict(new { error = "Idempotency key reused with different reservation" });
            var job = await jobs.GetAsync(input.JobId);
            if (job?.Status is not ("arrived" or "queued" or "in_progress"))
                return Results.Conflict(new { error = "Reservation requires an open job" });
            var result = await operations.ReserveAsync(id, input.JobId, input.Quantity, key, session.Subject);
            return result.Status switch
            {
                StockActionStatus.NotFound => Results.NotFound(),
                StockActionStatus.Conflict => Results.Conflict(new { error = "Idempotency key reused with different reservation" }),
                StockActionStatus.Insufficient => Results.Conflict(new { error = "Insufficient available stock" }),
                StockActionStatus.Duplicate => Results.Json(result.Value),
                _ => Results.Json(result.Value, statusCode: StatusCodes.Status201Created)
            };
        });
        app.MapPost("/api/auth/google", async (GoogleLoginInput input) =>
        {
            if (!staffAuth.IsConfigured) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
            var login = await staffAuth.LoginAsync(input.IdToken);
            return login is null ? Results.Unauthorized() : Results.Json(new
            {
                sessionToken = login.Value.Token,
                role = login.Value.Session.Role,
                expiresAt = login.Value.Session.ExpiresAt
            });
        });
        app.MapGet("/api/auth/session", (HttpContext context) =>
        {
            var session = staffAuth.Authenticate(context.Request.Headers.Authorization);
            return session is null
                ? Results.Unauthorized()
                : Results.Json(new
                {
                    subject = session.Subject,
                    role = session.Role,
                    expiresAt = session.ExpiresAt
                });
        });
        app.MapDelete("/api/auth/session", (HttpContext context) =>
        {
            var authorization = context.Request.Headers.Authorization;
            var signedOut = authorization.Count > 0 && staffAuth.SignOut(authorization.ToString());
            return signedOut ? Results.Json(new { ok = true }) : Results.Unauthorized();
        });
        app.MapPost("/api/payments/n1co/webhook", async (HttpContext context) =>
        {
            if (string.IsNullOrWhiteSpace(n1coWebhookSecret)) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
            const int maxBytes = 65536;
            if (context.Request.ContentLength > maxBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            using var body = new MemoryStream();
            var chunk = new byte[8192];
            int read;
            while ((read = await context.Request.Body.ReadAsync(chunk)) > 0)
            {
                if (body.Length + read > maxBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                body.Write(chunk, 0, read);
            }
            if (!N1coWebhookInbox.Verify(body.ToArray(), context.Request.Headers["X-H4B-Hmac-Sha256"].ToString(), n1coWebhookSecret))
                return Results.Unauthorized();
            if (!N1coWebhookInbox.TryParse(body.ToArray(), context.Request.Headers["X-H4B-Event-Id"].ToString(), out var webhook))
                return Results.BadRequest(new { error = "Invalid webhook event" });
            var added = await n1coInbox.AddAsync(webhook!);
            return Results.Json(new { accepted = true, duplicate = !added }, statusCode: StatusCodes.Status202Accepted);
        });
        app.MapGet("/openapi.json", () => Results.Json(new
        {
            openapi = "3.1.0",
            info = new { title = "SparkleWash API", version = "1.1.0" },
            paths = new Dictionary<string, object>
            {
                ["/api/arrivals/observations"] = new { post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Camera observation persisted" }, ["200"] = new { description = "Duplicate retry" } } } },
                ["/api/arrivals"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Staff arrival review queue" } } } },
                ["/api/arrivals/{id}/confirm"] = new { post = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Staff-confirmed plate and vehicle class" } } } },
                ["/api/arrivals/{id}/photo"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Retained arrival JPEG" } } } },
                ["/api/packages"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Shared detailing catalog" } } } },
                ["/api/packages/suggestion"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Package suggestion without a charge" } } } },
                ["/api/jobs"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Staff job list" } } }, post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Confirmed arrival opened as a job" } } } },
                ["/api/plates/{plate}/timeline"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Jobs and camera sightings for one plate" }, ["400"] = new { description = "Invalid plate" } } } },
                ["/api/jobs/summary"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Whole-carwash job totals and timing" } } } },
                ["/api/jobs/{id}"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Job detail" } } } },
                ["/api/jobs/{id}/transition"] = new { post = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Job status changed" } } } },
                ["/api/jobs/{id}/employees"] = new { post = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Employee assigned to job" } } } },
                ["/api/jobs/{id}/materials"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Job stock use and reservations" } } } },
                ["/api/employees"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Staff employee list" } } }, post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Employee created" } } } },
                ["/api/employees/{id}/status"] = new { post = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Employee active status changed" } } } },
                ["/api/inventory/items"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Stock balances and reorder flags" } } }, post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Inventory item created" } } } },
                ["/api/inventory/items/{id}/movements"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Append-only item movements" } } }, post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Stock receipt, adjustment, or consumption" } } } },
                ["/api/inventory/items/{id}/reservations"] = new { post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Stock reserved for a job" } } } },
                ["/api/auth/google"] = new { post = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Google ID token validated; SparkleWash staff session created" }, ["401"] = new { description = "Invalid token or unmapped Google subject" }, ["503"] = new { description = "Google client ID not configured" } } } },
                ["/api/auth/session"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Current staff session" }, ["401"] = new { description = "No valid staff session" } } }, delete = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Staff session ended" }, ["401"] = new { description = "No valid staff session" } } } },
                ["/api/payments/n1co/webhook"] = new { post = new { responses = new Dictionary<string, object> { ["202"] = new { description = "Signed event stored for reconciliation; not payment confirmation" }, ["401"] = new { description = "Invalid signature" } } } },
                ["/healthz"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Healthy" } } } },
                ["/api/metrics"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Demo station snapshots" } } } },
                ["/api/metrics/alerts"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Demo alerts" } } } },
                ["/api/upload"] = new { post = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Demo acknowledgement; no file is stored" }, ["422"] = new { description = "Declared body exceeds 524288 bytes" } } } },
                ["/api/stations/{stationId}/telemetry"] = new { post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Persisted station reading" }, ["401"] = new { description = "Invalid ingestion key" } } } },
                ["/api/stations/{stationId}/washes"] = new { post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Persisted wash record" }, ["401"] = new { description = "Invalid ingestion key" } } } },
                ["/api/washes/history"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Recorded washes" } } } },
                ["/api/metrics/summary"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Recorded fleet summary" } } } }
                , ["/api/stations/{stationId}/photos"] = new { post = new { responses = new Dictionary<string, object> { ["201"] = new { description = "Stored JPEG photos" }, ["413"] = new { description = "Actual request body exceeds 524288 bytes" } } }, get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Station photo metadata" } } } }
                , ["/api/photos/{photoId}"] = new { get = new { responses = new Dictionary<string, object> { ["200"] = new { description = "Stored JPEG bytes" }, ["404"] = new { description = "Photo not found" } } } }
                , ["/ws/app-station-streaming/{stationId}"] = new { get = new { responses = new Dictionary<string, object> { ["101"] = new { description = "Authenticated WebSocket upgrade" }, ["404"] = new { description = "Ordinary HTTP GET" } } } }
            }
        }));

        app.MapGet("/api/metrics", async (HttpContext context) =>
        {
            var live = await store.GetStationsAsync();
            if (live.Length > 0)
            {
                MarkSource(context, "station-ingest");
                return Results.Json(live);
            }
            MarkSource(context, "demo");
            var timestamp = DateTimeOffset.UtcNow.ToString("O");
            return Results.Json(new[]
            {
                new { stationId = "b4c3", name = "Bay #1 foam touch", status = "idle", pressurePsi = 52.0, soapLevelDm = 20, timestamp },
                new { stationId = "7d5c", name = "Bay #2 high pressure", status = "washing", pressurePsi = 58.5, soapLevelDm = 24, timestamp },
                new { stationId = "a1f2", name = "Bay #3 detail", status = "idle", pressurePsi = 48.0, soapLevelDm = 19, timestamp },
                new { stationId = "e8f1", name = "Bay #4 diamond polish", status = "cleaning", pressurePsi = 63.2, soapLevelDm = 26, timestamp }
            });
        });

        app.MapGet("/api/metrics/alerts", async (HttpContext context) =>
        {
            var live = await store.GetStationsAsync();
            if (live.Length > 0)
            {
                MarkSource(context, "station-ingest");
                return Results.Json(StationStore.DeriveAlerts(live));
            }
            MarkSource(context, "demo");
            return Results.Json(new[]
            {
                new { code = "lowPressure", value = 38.0, threshold = 45.0, severity = "warning" },
                new { code = "highPressure", value = 72.0, threshold = 60.0, severity = "danger" }
            });
        });

        app.MapPost("/api/stations/{stationId}/telemetry", async (HttpContext context, string stationId, TelemetryInput input) =>
        {
            if (!Authorized(context, ingestionKey)) return Results.Unauthorized();
            if (!ValidStationId(stationId) || !ValidTelemetry(input))
                return Results.BadRequest(new { error = "Invalid station telemetry" });
            var saved = await store.SaveTelemetryAsync(stationId, input);
            hub.Publish(saved);
            return Results.Json(saved, statusCode: StatusCodes.Status201Created);
        });

        app.MapGet("/ws/app-station-streaming/{stationId}", async (HttpContext context, string stationId) =>
        {
            if (!context.WebSockets.IsWebSocketRequest) return Results.NotFound();
            if (!ValidStationId(stationId) || !Authorized(context, streamKey, "X-SparkleWash-Stream-Key")) return Results.Unauthorized();
            var subscription = hub.Subscribe(stationId);
            if (subscription is null) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
            try
            {
                using var socket = await context.WebSockets.AcceptWebSocketAsync();
                using var clientClosed = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
                var receive = Task.Run(async () =>
                {
                    try
                    {
                        var buffer = new byte[256];
                        while (socket.State == WebSocketState.Open && !clientClosed.IsCancellationRequested)
                        {
                            var received = await socket.ReceiveAsync(buffer, clientClosed.Token);
                            if (received.MessageType == WebSocketMessageType.Close)
                            {
                                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "closing", CancellationToken.None);
                                break;
                            }
                        }
                    }
                    catch (OperationCanceledException) { }
                    catch (WebSocketException) { }
                    finally { clientClosed.Cancel(); }
                });
                var initial = (await store.GetStationsAsync()).FirstOrDefault(s => s.StationId == stationId);
                if (initial is not null) await SendFrame(socket, new { type = "station", station = initial }, clientClosed.Token);
                var lastSent = DateTimeOffset.UtcNow;
                while (socket.State == WebSocketState.Open && !clientClosed.IsCancellationRequested)
                {
                    using var heartbeat = CancellationTokenSource.CreateLinkedTokenSource(clientClosed.Token);
                    heartbeat.CancelAfter(TimeSpan.FromSeconds(heartbeatSeconds));
                    try
                    {
                        if (!await subscription.Value.Reader.WaitToReadAsync(heartbeat.Token)) break;
                        StationSnapshot? latest = null;
                        while (subscription.Value.Reader.TryRead(out var next)) latest = next;
                        if (latest is null) continue;
                        var remaining = TimeSpan.FromSeconds(1) - (DateTimeOffset.UtcNow - lastSent);
                        if (remaining > TimeSpan.Zero) await Task.Delay(remaining, clientClosed.Token);
                        while (subscription.Value.Reader.TryRead(out var newer)) latest = newer;
                        await SendFrame(socket, new { type = "station", station = latest }, clientClosed.Token);
                        lastSent = DateTimeOffset.UtcNow;
                    }
                    catch (OperationCanceledException) when (!clientClosed.IsCancellationRequested)
                    {
                        await SendFrame(socket, new { type = "heartbeat", timestamp = DateTimeOffset.UtcNow }, clientClosed.Token);
                    }
                }
                clientClosed.Cancel();
                await receive;
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            finally { hub.Unsubscribe(subscription.Value.Id); }
            return Results.Empty;
        });

        app.MapPost("/api/stations/{stationId}/washes", async (HttpContext context, string stationId, WashInput input) =>
        {
            if (!Authorized(context, ingestionKey)) return Results.Unauthorized();
            if (!ValidStationId(stationId) || input.Category is not ("basic" or "express" or "ceramic" or "premium") ||
                input.RevenueUsd is < 0 or > 100000)
                return Results.BadRequest(new { error = "Invalid wash record" });
            if (!(await store.GetStationsAsync()).Any(station => station.StationId == stationId)) return Results.NotFound();
            return Results.Json(await store.AddWashAsync(stationId, input), statusCode: StatusCodes.Status201Created);
        });

        app.MapGet("/api/washes/history", async (int? limit) =>
        {
            if (limit is < 1 or > 100) return Results.BadRequest(new { error = "limit must be 1 through 100" });
            return Results.Json((await store.GetWashesAsync()).Take(limit ?? 20));
        });

        app.MapPost("/api/stations/{stationId}/photos", async (HttpContext context, string stationId) =>
        {
            if (!Authorized(context, ingestionKey)) return Results.Unauthorized();
            if (!ValidStationId(stationId) || !(await store.GetStationsAsync()).Any(s => s.StationId == stationId)) return Results.NotFound();
            if (!context.Request.HasFormContentType) return Results.BadRequest(new { error = "Expected multipart/form-data" });
            const int maxRequestBytes = 524288;
            if (context.Request.ContentLength > maxRequestBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            using var bounded = new MemoryStream();
            var chunk = new byte[8192];
            int read;
            while ((read = await context.Request.Body.ReadAsync(chunk)) > 0)
            {
                if (bounded.Length + read > maxRequestBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                await bounded.WriteAsync(chunk.AsMemory(0, read));
            }
            if (bounded.Length == 0) return Results.BadRequest(new { error = "Empty upload" });
            bounded.Position = 0;
            context.Request.Body = bounded;
            context.Request.ContentLength = bounded.Length;
            IFormCollection form;
            try { form = await context.Request.ReadFormAsync(); }
            catch (InvalidDataException) { return Results.BadRequest(new { error = "Malformed multipart body" }); }
            if (form.Files.Count is < 1 or > 2 || form.Files.Count > photoStore.MaxCount ||
                form.Files.Any(file => file.Name != "photos" || file.ContentType != "image/jpeg"))
                return Results.BadRequest(new { error = "One or two JPEG photos are required" });
            var photos = new List<byte[]>();
            foreach (var file in form.Files)
            {
                using var image = new MemoryStream();
                await file.CopyToAsync(image);
                var bytes = image.ToArray();
                if (!PhotoStore.IsJpeg(bytes)) return Results.BadRequest(new { error = "Invalid JPEG photo" });
                photos.Add(bytes);
            }
            var saved = await photoStore.SaveAsync(stationId, photos);
            return Results.Json(new { photos = saved }, statusCode: StatusCodes.Status201Created);
        });

        app.MapGet("/api/stations/{stationId}/photos", async (HttpContext context, string stationId) =>
        {
            if (!Authorized(context, ingestionKey)) return Results.Unauthorized();
            if (!ValidStationId(stationId)) return Results.NotFound();
            return Results.Json(await photoStore.ListAsync(stationId));
        });

        app.MapGet("/api/photos/{photoId}", async (HttpContext context, string photoId) =>
        {
            if (!Authorized(context, ingestionKey)) return Results.Unauthorized();
            var bytes = await photoStore.GetAsync(photoId);
            return bytes is null ? Results.NotFound() : Results.File(bytes, "image/jpeg");
        });

        app.MapGet("/api/metrics/summary", async (HttpContext context) =>
        {
            var stations = await store.GetStationsAsync();
            var washes = await store.GetWashesAsync();
            MarkSource(context, stations.Length > 0 ? "station-ingest" : "demo");
            return Results.Json(new
            {
                stationCount = stations.Length,
                activeStations = stations.Count(x => x.Status is "washing" or "cleaning" or "drying"),
                washCount = washes.Length,
                revenueUsd = washes.Sum(x => x.RevenueUsd),
                latestStationTimestamp = stations.Length > 0 ? stations.Max(x => x.Timestamp) : (DateTimeOffset?)null
            });
        });

        app.MapPost("/api/upload", async (HttpContext context) =>
        {
            MarkSource(context, "demo");
            var length = context.Request.ContentLength;
            if (length is null or 0) return Results.BadRequest(new { error = "A nonempty request body with Content-Length is required" });
            if (length > MaxDemoUploadBytes) return Results.UnprocessableEntity(new { error = "Declared upload exceeds 524288 bytes" });

            // The compatibility endpoint acknowledges requests without persisting photos.
            var photos = false;
            if (context.Request.HasFormContentType)
            {
                var form = await context.Request.ReadFormAsync();
                photos = form.Files.Any(file => file.Name == "photos") || form.ContainsKey("photos");
            }
            else
            {
                using var reader = new StreamReader(context.Request.Body);
                photos = (await reader.ReadToEndAsync()).Contains("photos", StringComparison.Ordinal);
            }
            return photos
                ? Results.Json(new { ok = true })
                : Results.Json(new { ok = true, uploadId = Guid.NewGuid().ToString() });
        });

        app.MapGet("/api/upload/{uploadId}", (HttpContext context, string uploadId) =>
        {
            MarkSource(context, "demo");
            return Results.Json(new { uploadId, stored = false });
        });

        return app;
    }

    private static void MarkSource(HttpContext context, string source) => context.Response.Headers["X-SparkleWash-Data-Source"] = source;
    internal static bool ValidStationId(string stationId) => stationId.Length is >= 1 and <= 64 && stationId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    internal static bool ValidTelemetry(TelemetryInput? input) => input is not null &&
        !string.IsNullOrWhiteSpace(input.Name) && input.Name.Length <= 100 &&
        input.Status is ("idle" or "washing" or "cleaning" or "drying" or "error") &&
        double.IsFinite(input.PressurePsi) && input.PressurePsi is >= 0 and <= 150 &&
        double.IsFinite(input.SoapLevelDm) && input.SoapLevelDm is >= 0 and <= 100;
    private static bool ValidIdempotencyKey(string? key) => key is not null && key.Length is >= 8 and <= 128 &&
        key.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    private static bool Authorized(HttpContext context, string? key, string header = "X-SparkleWash-Ingest-Key")
    {
        if (string.IsNullOrEmpty(key) || !context.Request.Headers.TryGetValue(header, out var supplied)) return false;
        var expected = System.Text.Encoding.UTF8.GetBytes(key);
        var actual = System.Text.Encoding.UTF8.GetBytes(supplied.ToString());
        return expected.Length == actual.Length && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(expected, actual);
    }
    private static async Task SendFrame(WebSocket socket, object frame, CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(frame, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }

    public static async Task Main(string[] args) => await BuildApp(args).RunAsync();
}
