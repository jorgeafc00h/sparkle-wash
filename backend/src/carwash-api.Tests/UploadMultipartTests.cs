using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;

namespace CarwashApi.Tests;

[Collection("CarwashApiServer")]
public class UploadApiTests : IClassFixture<ServerFixture>
{
    private readonly HttpClient _client;

    public UploadApiTests(ServerFixture fixture) => _client = fixture.Client;

    [Fact]
    public async Task Upload_MultipartFieldNamedPhotos_ReturnsOkWithoutUploadId()
    {
        using var content = NewUpload();
        // The live API treats a part named "photos" as the photos-only shortcut path.
        content.Add(new StringContent("fake-binary-data", Encoding.UTF8, "text/plain"), "photos", "photo-001.jpg");

        var response = await _client.PostAsync("/api/upload", content);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("ok", "upload should be reported as ok");
        body.Should().NotContain("uploadId", "photo uploads should not allocate a station upload token");
    }

    [Fact]
    public async Task Upload_MultipartWithStationName_ReturnsUploadId()
    {
        using var content = NewUpload();
        var response = await _client.PostAsync("/api/upload", content);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("uploadId", "station-bound uploads should include an uploadId");
    }

    [Fact]
    public async Task Upload_TooLargeContentLength_Returns422()
    {
        using var content = NewUpload();
        // Pad past the 512 KiB limit with a single large part.
        var big = new string('A', 524300);
        content.Add(new StringContent(big, Encoding.UTF8, "text/plain"), "photos", "big-data.bin");

        var response = await _client.PostAsync("/api/upload", content);

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity, "uploads above 512 KiB should be rejected with 422");
    }

    [Fact]
    public async Task Upload_GetById_Returns200_WithGivenId()
    {
        // The live API's GET /api/upload/{id} is informational and returns 200 with the id echoed.
        var response = await _client.GetAsync("/api/upload/does-not-exist");

        response.StatusCode.Should().Be(HttpStatusCode.OK, "GET /api/upload/{id} is informational and always 200");
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("does-not-exist", "GET /api/upload/{id} should echo the upload id");
    }

    [Fact]
    public async Task Health_GetMethod_AndBodyMatches()
    {
        var response = await _client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("healthy", "GET /health body should carry a healthy marker");
    }

    [Fact]
    public async Task Upload_NonMultipartBody_AcceptedGracefully()
    {
        // POST /api/upload accepts any body (it only cares about the photo part name and length).
        var encoded = Encoding.UTF8.GetBytes("not really multipart, but a non-empty body");
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/upload")
        {
            Content = new ByteArrayContent(encoded)
        };

        var response = await _client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("ok");
    }

    private static MultipartFormDataContent NewUpload()
    {
        var content = new MultipartFormDataContent();
        var bytes = new byte[10240];
        new Random(0x67C9D6F).NextBytes(bytes);
        content.Add(new ByteArrayContent(bytes), "station", "metadata.json");
        return content;
    }
}
