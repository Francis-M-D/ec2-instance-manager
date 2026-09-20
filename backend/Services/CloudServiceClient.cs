using System.Net.Http.Headers;
using System.Net.Http.Json;
using Ec2Manager.DTOs;

namespace Ec2Manager.Services;

public class CloudServiceClient
{
    private readonly HttpClient _http;

    public CloudServiceClient(HttpClient http, IConfiguration config)
    {
        var baseUrl = Environment.GetEnvironmentVariable("EC2MANAGER_CLOUD_SERVICE_URL")
            ?? config["CloudService:BaseUrl"]
            ?? "http://localhost:8001";
        var apiKey = Environment.GetEnvironmentVariable("EC2MANAGER_INTERNAL_API_KEY")
            ?? config["CloudService:InternalApiKey"]
            ?? throw new InvalidOperationException("EC2MANAGER_INTERNAL_API_KEY not configured");

        http.BaseAddress = new Uri(baseUrl);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        _http = http;
    }

    public async Task<List<CloudInstanceDto>> ListInstancesAsync(
        string accountKey, string? region, List<string>? statuses, string? search)
    {
        var resp = await _http.PostAsJsonAsync("/instances/list", new
        {
            accountKey,
            region,
            statuses,
            search,
        });
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<List<CloudInstanceDto>>() ?? new();
    }

    public async Task<CloudActionResultDto> StartInstancesAsync(
        string accountKey, string region, List<string> instanceIds, bool dryRun)
    {
        var resp = await _http.PostAsJsonAsync("/instances/start", new { accountKey, region, instanceIds, dryRun });
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<CloudActionResultDto>() ?? new();
    }

    public async Task<CloudActionResultDto> StopInstancesAsync(
        string accountKey, string region, List<string> instanceIds, bool dryRun)
    {
        var resp = await _http.PostAsJsonAsync("/instances/stop", new { accountKey, region, instanceIds, dryRun });
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<CloudActionResultDto>() ?? new();
    }

    public async Task<List<string>> GetRegionsAsync(string accountKey)
    {
        var resp = await _http.GetAsync($"/accounts/{accountKey}/regions");
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<List<string>>() ?? new();
    }
}
