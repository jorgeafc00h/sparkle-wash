using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Xunit;

namespace CarwashApi.Tests;

public class PhotoUploadTests
{
    [Fact]
    public async Task BoundedPhotosAreStoredRetrievedAndPruned()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-photos-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var image = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "tiny.jpg"));
        string lastId;
        try
        {
            await using (var app = await Start(directory))
            {
                using var client = NewClient(app);
                (await client.PostAsJsonAsync("/api/stations/photo-bay/telemetry", new { name = "Photo bay", status = "idle", pressurePsi = 50, soapLevelDm = 50 })).StatusCode.Should().Be(HttpStatusCode.Created);
                using (var malformed = NewPhoto([0xff, 0xd8, 0xff, 0xd9]))
                    (await client.PostAsync("/api/stations/photo-bay/photos", malformed)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
                using (var first = NewPhoto(image))
                {
                    var response = await client.PostAsync("/api/stations/photo-bay/photos", first);
                    response.StatusCode.Should().Be(HttpStatusCode.Created);
                    var firstId = await PhotoId(response);
                    (await client.GetByteArrayAsync("/api/photos/" + firstId)).Should().Equal(image);
                    await Task.Delay(10);
                    using var second = NewPhoto(image);
                    var next = await client.PostAsync("/api/stations/photo-bay/photos", second);
                    next.StatusCode.Should().Be(HttpStatusCode.Created);
                    lastId = await PhotoId(next);
                    (await client.GetAsync("/api/photos/" + firstId)).StatusCode.Should().Be(HttpStatusCode.NotFound);
                }
                using var list = JsonDocument.Parse(await client.GetStringAsync("/api/stations/photo-bay/photos"));
                list.RootElement.GetArrayLength().Should().Be(1);
                list.RootElement[0].GetProperty("id").GetString().Should().Be(lastId);
                using var anonymous = new HttpClient { BaseAddress = client.BaseAddress };
                (await anonymous.GetAsync("/api/photos/" + lastId)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

                using var oversized = NewPhoto(new byte[524300]);
                var chunked = new HttpRequestMessage(HttpMethod.Post, "/api/stations/photo-bay/photos") { Content = oversized };
                chunked.Headers.TransferEncodingChunked = true;
                (await client.SendAsync(chunked)).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
            }
            await using (var restarted = await Start(directory))
            {
                using var client = NewClient(restarted);
                (await client.GetByteArrayAsync("/api/photos/" + lastId)).Should().Equal(image);
            }
        }
        finally { Directory.Delete(directory, true); }
    }

    private static async Task<string> PhotoId(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("photos")[0].GetProperty("id").GetString()!;
    }
    private static MultipartFormDataContent NewPhoto(byte[] bytes)
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "photos", "photo.jpg");
        return form;
    }
    private static async Task<WebApplication> Start(string directory)
    {
        var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0", "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
            "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos"), "--SPARKLEWASH_PHOTO_MAX_COUNT", "1", "--SPARKLEWASH_INGEST_KEY", "photo-secret"]);
        await app.StartAsync();
        return app;
    }
    private static HttpClient NewClient(WebApplication app)
    {
        var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        client.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "photo-secret");
        return client;
    }
}
