namespace CarwashApi.DevHost;

/// <summary>
/// Accepts <c>dev:&lt;subject&gt;:&lt;email&gt;</c> tokens so desktop/iOS end-to-end runs can sign in without Google.
/// Refuses to exist outside ASPNETCORE_ENVIRONMENT=Development.
/// </summary>
public sealed class DevIdentityVerifier : IGoogleIdentityVerifier
{
    public DevIdentityVerifier()
    {
        if (!IsDevelopment())
            throw new InvalidOperationException("DevIdentityVerifier only runs with ASPNETCORE_ENVIRONMENT=Development.");
    }

    public static bool IsDevelopment() =>
        string.Equals(Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"), "Development", StringComparison.Ordinal);

    public Task<string?> VerifySubjectAsync(string idToken, string clientId) =>
        Task.FromResult(Parse(idToken)?.Subject);

    public Task<GoogleIdentity?> VerifyAsync(string idToken, string clientId) => Task.FromResult(Parse(idToken));

    private static GoogleIdentity? Parse(string? token)
    {
        if (!IsDevelopment() || token is null) return null;
        var parts = token.Split(':', 3);
        if (parts.Length != 3 || parts[0] != "dev" || parts[1].Length == 0 || !parts[2].Contains('@')) return null;
        return new GoogleIdentity(parts[1], parts[2], true, parts[1]);
    }
}

public static class DevHostProgram
{
    public static async Task Main(string[] args)
    {
        if (!DevIdentityVerifier.IsDevelopment())
        {
            Console.Error.WriteLine("Car Spa DevHost refuses to start: set ASPNETCORE_ENVIRONMENT=Development.");
            Environment.Exit(1);
            return;
        }
        await CarwashApi.Program.BuildApp(args, new DevIdentityVerifier()).RunAsync();
    }
}
