using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;
using FluentAssertions;

namespace CarwashApi.Tests;

/// <summary>
/// Unit tests specifically for the multipart upload endpoint logic.
/// Validates boundary parsing, field name extraction, and response format.
/// </summary>
public class UploadMultipartTests
{
    [Fact]
    public void MultipartParsing_ShouldExtractPhotoFieldName()
    {
        // Test input: a multipart body line containing the photos field
        string multipartLine = "Name: \"photos\"; filename=\"photo-001.jpg\"";

        var result = ParseMultipartFieldName(multipartLine);

        result.Should().NotBeNull();
        result.Should().Be("photos");
    }

    [Fact]
    public void MultipartParsing_ShouldRejectNonPhotoName()
    {
        string multipartLine = "Name: \"action\"; filename=\"action=washing\"";

        var result = ParseMultipartFieldName(multipartLine);

        Assert.False(result != null && result.Contains("photos"),
            "field name should only be 'photos'");
    }

    [Fact]
    public void MultipartParsing_ShouldSkipBoundaryMarkers()
    {
        string[] lines = {
            "--WebKitFormBoundary123456",
            "Name: photos; filename=photo.jpg",
            "--WebKitFormBoundary123456--"
        };

        string? fieldName = null;
        foreach (var line in lines)
        {
            if (line.TrimStart() == "--") continue;
            int semicolons = line.IndexOf(';');
            if (semicolons > 0)
                fieldName = line.Substring(semicolons + 1).Replace(" ", "");
        }

        fieldName.Should().Be("photos");
    }

    [Fact]
    public void ExtractFilename_ShouldGetPhotoNameFromContentDisposition()
    {
        string contentDisposition = "Content-Disposition: form-data; name=\"photos\"; filename=\"photo_001.jpg\"";

        var startIdx = contentDisposition.IndexOf("filename=\"");
        Assert.True(startIdx != -1);

        for (int i = startIdx + 9; i < contentDisposition.Length - 1; i++)
            if (contentDisposition[i] == '"' || contentDisposition[i] == '\\') break;

        var filename = contentDisposition.Substring(startIdx + 9, Math.Min(250, i - startIdx));

        Assert.Equal("photo_001.jpg", filename);
    }

    [Fact]
    public void BuildPhotoUploadResponse_ShouldReturnCreatedWithId()
    {
        var response = new BuildResponseResult();

        var result = response.Build("/api/upload/abc123", "photo.jpg", 1024);

        result.Should().ContainKey("uploadId");
        ((dynamic)response.UploadResponse).uploadId.Should().NotBeNullOrEmpty();
        Assert.Equal(HttpStatusCode.Created, result.StatusCode);
    }

    [Fact]
    public void UploadError_ShouldReturnBad_RequestFormat()
    {
        // When the request doesn't contain a photos field
        var response = new BuildResponseResult { Ok = false };

        var json = JsonSerializer.Serialize(response.Build());

        obj => var payload = JsonSerializer.Deserialize<dynamic>(json);
        payload.ok.Should().BeFalse();
        payload.reason.Should().Contain("Photos must be in an array named 'photos'");
    }

    [Fact]
    public void UploadResponse_Schema_MatchesOpenApi()
    {
        // Validate our responses match the OpenAPI 3.1 spec
        var response = new BuildResponseResult();

        dynamic payload = response.UploadResponse;

        Assert.Equal("uploadId", ((dynamic)payload).Properties.Keys[0]);
        Assert.Equal("photoBytes", ((dynamic)payload).Properties.Keys[1]);
        Assert.Equal("stationId", ((dynamic)payload).Properties.Keys[2]);
    }
}

// Dummy class for testing the response builder logic
public class BuildResponseResult
{
    public bool Ok { get; set; } = true;
    public string? UploadId { get; set; } = Guid.NewGuid().ToString();
    public int PhotoBytes { get; set; }
    public string StationId { get; set; } = "b4c3";

    public static BuildResponseResult FromUpload(int photoBytes, string stationId) =>
        new()
        {
            Ok = true,
            UploadId = Guid.NewGuid().ToString(),
            PhotoBytes = photoBytes,
            StationId = stationId,
        };

    public static System.Net.HttpStatusCode FromUploadError() => System.Net.HttpStatusCode.Conflict;
}
