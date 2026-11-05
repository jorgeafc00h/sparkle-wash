using System.Text.Json;
using System.Text.Json.Serialization;

namespace CarwashApi;

// Catalog text is in the business's language (Locale, Spanish); Translations holds other languages by code.
public sealed record CatalogTranslation(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Subtitle,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Tagline,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string[]? Items);
public sealed record VehicleClass(string Id, string Name, Dictionary<string, CatalogTranslation> Translations);
public sealed record ServicePackage(string Id, string Name, string Subtitle, string Tagline, string[] Items,
    Dictionary<string, decimal> Prices, Dictionary<string, CatalogTranslation> Translations);
public sealed record CatalogResponse(string Currency, string Locale, VehicleClass[] VehicleClasses, ServicePackage[] Packages);
public sealed record PackageSuggestion(string VehicleClass, string PackageId, decimal PriceUsd, string Reason);

public static class PackageCatalog
{
    public static readonly CatalogResponse Current = Load();

    public static PackageSuggestion? Suggest(string vehicleClass)
    {
        if (!Current.VehicleClasses.Any(item => item.Id == vehicleClass)) return null;
        var standard = Current.Packages.Single(item => item.Id == "essential");
        return new PackageSuggestion(vehicleClass, standard.Id, standard.Prices[vehicleClass],
            "Essential Spa is the starting suggestion; staff confirm the vehicle class and package before opening a job.");
    }

    private static CatalogResponse Load()
    {
        using var stream = typeof(PackageCatalog).Assembly.GetManifestResourceStream("SparkleWash.ServicePackages.json")
            ?? throw new InvalidOperationException("Embedded service package catalog is missing");
        return JsonSerializer.Deserialize<CatalogResponse>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidDataException("Service package catalog is empty");
    }
}
