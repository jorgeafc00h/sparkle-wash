using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using CarwashApi;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

[AttributeUsage(AttributeTargets.Method)]
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SPARKLEWASH_TEST_POSTGRES")))
            Skip = "Set SPARKLEWASH_TEST_POSTGRES to the disposable PostgreSQL test database to run database integration tests.";
    }
}

public sealed class PostgresStoreIntegrationTests
{
    private const string RuntimePassword = "local-test-only-sparklewash";

    [PostgresFact]
    public async Task OperationalStoresAreTenantScopedTransactionalAndRestartSafe()
    {
        var adminConnectionString = Environment.GetEnvironmentVariable("SPARKLEWASH_TEST_POSTGRES")!;
        var adminBuilder = new NpgsqlConnectionStringBuilder(adminConnectionString);
        if (adminBuilder.Database != "sparklewash_test" || adminBuilder.Host is not ("localhost" or "127.0.0.1" or "::1" or "postgres"))
            throw new InvalidOperationException("SPARKLEWASH_TEST_POSTGRES must point to the disposable local database named sparklewash_test.");
        adminBuilder.Pooling = false;

        await using var admin = new NpgsqlConnection(adminBuilder.ConnectionString);
        await admin.OpenAsync();
        await ExecuteAsync(admin, "DROP SCHEMA IF EXISTS sparklewash CASCADE; DROP ROLE IF EXISTS sparklewash_runtime;");
        var migrationsPath = Path.Combine(AppContext.BaseDirectory, "Migrations");
        foreach (var file in Directory.GetFiles(migrationsPath, "*.sql").Where(path => !path.EndsWith("grant-runtime.sql", StringComparison.Ordinal)).OrderBy(path => path, StringComparer.Ordinal))
            await ExecuteAsync(admin, await File.ReadAllTextAsync(file));
        await ExecuteAsync(admin, $"CREATE ROLE sparklewash_runtime LOGIN PASSWORD '{RuntimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;");
        await ExecuteAsync(admin, await File.ReadAllTextAsync(Path.Combine(migrationsPath, "grant-runtime.sql")));

        var runtimeBuilder = new NpgsqlConnectionStringBuilder(adminBuilder.ConnectionString)
        {
            Username = "sparklewash_runtime",
            Password = RuntimePassword,
            Pooling = false
        };
        await using var dataSource = NpgsqlDataSource.Create(runtimeBuilder.ConnectionString);
        var tenantA = "ita" + Guid.NewGuid().ToString("N");
        var tenantB = "itb" + Guid.NewGuid().ToString("N");
        await InsertTenantAsync(admin, tenantA);
        await InsertTenantAsync(admin, tenantB);

        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-postgres-it-" + Guid.NewGuid().ToString("N"));
        var photos = new PhotoStore(Path.Combine(directory, "photos"));
        try
        {
            var devicesA = new PostgresDeviceStore(dataSource, tenantA);
            var createdDevice = await devicesA.CreateAsync(tenantA,
                new DeviceInput("Integration camera", "camera-it", "entry"), "staff-1");
            Assert.Equal(DeviceCreateStatus.Created, createdDevice.Status);
            Assert.NotNull(createdDevice.Key);
            var parsedDeviceKey = DeviceStore.ParseKey(createdDevice.Key);
            Assert.NotNull(parsedDeviceKey);
            Assert.NotNull(await devicesA.AuthenticateAsync(parsedDeviceKey.Value.DeviceId, parsedDeviceKey.Value.Secret));
            Assert.Null(await devicesA.AuthenticateAsync(parsedDeviceKey.Value.DeviceId, parsedDeviceKey.Value.Secret + "wrong"));
            Assert.Empty(await new PostgresDeviceStore(dataSource, tenantB).ListAsync());

            var arrivalsA = new PostgresArrivalStore(new PostgresWorkflowDatabase(dataSource, tenantA));
            var arrivalsB = new PostgresArrivalStore(new PostgresWorkflowDatabase(dataSource, tenantB));
            var input = new ArrivalInput("event-" + Guid.NewGuid().ToString("N"), "camera-a", "abc-123", 0.97,
                DateTimeOffset.UtcNow, null);
            var concurrentAdds = await Task.WhenAll(Enumerable.Range(0, 16)
                .Select(_ => arrivalsA.AddAsync(input, null, photos)));

            Assert.Single(concurrentAdds, result => result.Status == ArrivalAddStatus.Created);
            Assert.Equal(15, concurrentAdds.Count(result => result.Status == ArrivalAddStatus.Duplicate));
            Assert.Empty(await arrivalsB.ListAsync());
            var arrival = Assert.Single(await arrivalsA.ListAsync());
            Assert.Equal(ArrivalConfirmStatus.Confirmed,
                (await arrivalsA.ConfirmAsync(arrival.Id, "ABC123", "car", "staff-1")).Status);

            var workflowA = new PostgresWorkflowDatabase(dataSource, tenantA);
            var jobsA = new PostgresJobStore(workflowA);
            var package = PackageCatalog.Current.Packages.Single(item => item.Id == "quick");
            var created = await jobsA.CreateAsync((await arrivalsA.ListAsync()).Single(), package, "open-1", "staff-1");
            Assert.Equal(JobActionStatus.Created, created.Status);
            var job = Assert.IsType<JobView>(created.Job);

            var operationsA = new PostgresOperationsStore(workflowA);
            var employee = Assert.IsType<Employee>(await operationsA.AddEmployeeAsync("DB test worker"));
            Assert.Equal(JobActionStatus.Created, (await jobsA.AssignAsync(job.Id, employee, "assign-1")).Status);
            Assert.Equal(JobActionStatus.Created, (await jobsA.TransitionAsync(job.Id, "queued", "queue-1", "staff-1")).Status);
            Assert.Equal(JobActionStatus.Created, (await jobsA.TransitionAsync(job.Id, "in_progress", "start-1", "staff-1")).Status);

            var item = Assert.IsType<InventoryItem>(await operationsA.AddItemAsync(new InventoryItemInput("IT-SOAP", "Test soap", "ml", 1)));
            Assert.Equal(StockActionStatus.Created, (await operationsA.MoveAsync(item.Id,
                new StockMovementInput("receipt", 5, "test stock", null, null), "receipt-1", "staff-1")).Status);
            var consumption = await Task.WhenAll(
                operationsA.MoveAsync(item.Id, new StockMovementInput("consume", 4, "test use", job.Id, employee.Id), "consume-a", "staff-1"),
                operationsA.MoveAsync(item.Id, new StockMovementInput("consume", 4, "test use", job.Id, employee.Id), "consume-b", "staff-1"));
            Assert.Single(consumption, result => result.Status == StockActionStatus.Created);
            Assert.Single(consumption, result => result.Status == StockActionStatus.Insufficient);
            Assert.Equal(1, Assert.Single(await operationsA.ItemsAsync()).OnHand);
            Assert.Empty(await new PostgresOperationsStore(new PostgresWorkflowDatabase(dataSource, tenantB)).ItemsAsync());

            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SPARKLEWASH_GOOGLE_CLIENT_ID"] = "integration-test-client",
                ["SPARKLEWASH_STAFF_ROLES"] = "123456789=admin"
            }).Build();
            var firstAuth = new StaffAuth(config, new PostgresTenantDirectory(dataSource, 500), new IntegrationIdentityVerifier(), dataSource);
            var login = Assert.IsType<(string Token, StaffSession Session)>(await firstAuth.LoginAsync("integration-test-token"));
            var restartedAuth = new StaffAuth(config, new PostgresTenantDirectory(dataSource, 500), new IntegrationIdentityVerifier(), dataSource);
            Assert.Equal("admin", (await restartedAuth.AuthenticateAsync("Bearer " + login.Token))?.Role);
            Assert.True(await restartedAuth.SignOutAsync("Bearer " + login.Token));
            Assert.Null(await firstAuth.AuthenticateAsync("Bearer " + login.Token));
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task InsertTenantAsync(NpgsqlConnection connection, string id)
    {
        await using var command = new NpgsqlCommand("""
            INSERT INTO sparklewash.tenants (id,name,country,time_zone,created_at)
            VALUES ($1,'Integration test','SV','America/El_Salvador',now())
            """, connection);
        command.Parameters.AddWithValue(id);
        await command.ExecuteNonQueryAsync();
    }

    private sealed class IntegrationIdentityVerifier : IGoogleIdentityVerifier
    {
        public Task<string?> VerifySubjectAsync(string idToken, string clientId) => Task.FromResult<string?>("123456789");
    }
}
