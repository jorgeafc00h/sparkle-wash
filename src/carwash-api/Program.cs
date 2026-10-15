using System;
using System.IO;
using System.Text.Json;
using System.Text;
using Microsoft.AspNetCore.Http;

namespace CarwashApi;

public static class Program
{
    public static async Task<int> Main() => await RunAsync(Array.Empty<string>());

    public static async Task<int> RunAsync(string[] args)
    {
        Console.WriteLine("SparkleWash API on http://localhost:5001");
        using var app = WebApplication.Create();
        app.MapGet("/health", () => Results.Json(new { status = "healthy" }));
        app.MapPost("/health", () => Results.Json(new { ok = true, message = "healthy" }));
        app.MapGet("/api/metrics", GetMetrics);
        app.MapGet("/api/metrics/alerts", GetAlerts);
        app.MapPost("/api/upload", context => OnUpload(context));
        app.MapGet("/api/upload/{uploadId}", GetUpload);
        await app.RunAsync((string)null!);
        return 0;
    }

    private static async Task OnUpload(HttpContext context)
    {
        var cl = context.Request.ContentLength ?? -1L;
        if (cl < 0) { context.Response.StatusCode = 400; await context.Response.WriteAsync("Empty"); return; }
        if (cl > 524288) { context.Response.StatusCode = 422; await context.Response.WriteAsync("Too big"); return; }
        using var sr = new StreamReader(context.Request.Body, Encoding.UTF8);
        string t = await sr.ReadToEndAsync();
        if (t.Contains("\"name\":\"photos\""))
            await context.Response.WriteAsJsonAsync(new { ok = true });
        else
            await context.Response.WriteAsJsonAsync(new { ok = true, uploadId = Guid.NewGuid().ToString("N") });
    }

    private static IResult GetMetrics()
    {
        string dt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        var result = new[]
        {
            new { stationId = "b4c3", name = "Bay #1 foam touch", status = "idle", pressurePsi = 52.0, soapLevelDm = 20, timestamp = dt },
            new { stationId = "7d5c", name = "Bay #2 high pressure", status = "washing", pressurePsi = 58.5, soapLevelDm = 24, timestamp = dt },
            new { stationId = "a1f2", name = "Bay #3 detail", status = "idle", pressurePsi = 48.0, soapLevelDm = 19, timestamp = dt },
            new { stationId = "e8f1", name = "Bay #4 diamond polish", status = "cleaning", pressurePsi = 63.2, soapLevelDm = 26, timestamp = dt }
        };
        var jsonStr = JsonSerializer.Serialize(result, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        return Results.Content($"[{jsonStr}]", "application/json");
    }

    private static IResult GetAlerts() => Results.Json(new[]
    {
        new { code = "lowPressure", value = 32, threshold = 25.0f, severity = "warning" },
        new { code = "highPressure", value = 68, threshold = 70.0f, severity = "warning" }
    });

    private static IResult GetUpload(string uploadId) => Results.Json(new { ok = true, uploadId });
}
