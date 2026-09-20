using System.Security.Claims;
using Ec2Manager.DTOs;
using Ec2Manager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ec2Manager.Controllers;

[ApiController]
[Route("[controller]")]
[Authorize]
public class InstancesController : ControllerBase
{
    private readonly CloudServiceClient _cloud;
    private readonly AuditService _audit;

    public InstancesController(CloudServiceClient cloud, AuditService audit)
    {
        _cloud = cloud;
        _audit = audit;
    }

    private string CurrentUserName => User.FindFirstValue(ClaimTypes.Name)
        ?? User.Identity?.Name ?? "unknown";

    private int? CurrentUserId =>
        int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    [HttpGet]
    public async Task<ActionResult<List<InstanceListItemDto>>> GetInstances(
        [FromQuery] string? accountKeys,
        [FromQuery] string? regions,
        [FromQuery] string? statuses,
        [FromQuery] string? search,
        [FromQuery] bool? dnsOnly)
    {
        var accountList = Split(accountKeys);
        var regionList = Split(regions);
        var statusList = Split(statuses);

        if (accountList.Count == 0)
            return BadRequest("At least one accountKey is required");

        var all = new List<CloudInstanceDto>();
        foreach (var acct in accountList)
        {
            if (regionList.Count == 0)
            {
                all.AddRange(await _cloud.ListInstancesAsync(acct, null, statusList.Count > 0 ? statusList : null, search));
            }
            else
            {
                foreach (var region in regionList)
                    all.AddRange(await _cloud.ListInstancesAsync(acct, region, statusList.Count > 0 ? statusList : null, search));
            }
        }

        // dnsOnly=true means "hide protected" — DnsEnabled now represents
        // "protected" (DNS=Yes), so hiding protected means keeping the
        // instances where DnsEnabled is false.
        var filtered = dnsOnly == true ? all.Where(i => !i.DnsEnabled) : all;

        var result = filtered.Select(i => new InstanceListItemDto(
            i.InstanceId, i.Name, i.State, i.DnsEnabled, i.PublicIp, i.PrivateIp,
            i.Region, i.AccountKey, i.LaunchTime, i.InstanceType)).ToList();

        return Ok(result);
    }

    [HttpGet("{instanceId}")]
    public async Task<ActionResult<InstanceDetailDto>> GetInstance(
        string instanceId, [FromQuery] string accountKey, [FromQuery] string? region)
    {
        var matches = await _cloud.ListInstancesAsync(accountKey, region, null, instanceId);
        var inst = matches.FirstOrDefault(i => i.InstanceId == instanceId);
        if (inst == null) return NotFound();

        return Ok(new InstanceDetailDto(
            inst.InstanceId, inst.Name, inst.State, inst.DnsEnabled, inst.PublicIp, inst.PrivateIp,
            inst.Region, inst.AccountKey, inst.LaunchTime, inst.InstanceType, inst.Tags));
    }

    [HttpPost("start")]
    public Task<ActionResult<InstanceActionResponse>> Start(InstanceActionRequest req) =>
        DoAction(req, "start", "ManualStart");

    [HttpPost("stop")]
    public Task<ActionResult<InstanceActionResponse>> Stop(InstanceActionRequest req) =>
        DoAction(req, "stop", "ManualStop");

    private async Task<ActionResult<InstanceActionResponse>> DoAction(
        InstanceActionRequest req, string action, string auditActionType)
    {
        if (req.InstanceIds.Count == 0) return BadRequest("instanceIds is required");

        var result = action == "start"
            ? await _cloud.StartInstancesAsync(req.AccountKey, req.Region, req.InstanceIds, req.DryRun)
            : await _cloud.StopInstancesAsync(req.AccountKey, req.Region, req.InstanceIds, req.DryRun);

        var acted = action == "start" ? result.WouldStart ?? new() : result.WouldStop ?? new();
        var skipped = result.WouldSkip ?? new();
        var errors = result.Errors ?? new();

        var outcome = errors.Count > 0
            ? (acted.Count > 0 ? "Partial" : "Failed")
            : "Success";

        var message = req.DryRun
            ? $"Dry run: {acted.Count} would {action}, {skipped.Count} would be skipped"
            : $"{acted.Count} instance(s) {(action == "start" ? "started" : "stopped")}, {skipped.Count} skipped";

        await _audit.LogAsync(
            auditActionType, req.AccountKey, req.Region, req.InstanceIds, req.DryRun,
            outcome, message, errors.Count > 0 ? string.Join("; ", errors.Select(e => e.ToString())) : null,
            CurrentUserId, CurrentUserName);

        return Ok(new InstanceActionResponse(
            result.WouldStart ?? new(), result.WouldStop ?? new(), skipped, errors));
    }

    private static List<string> Split(string? csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? new()
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}
