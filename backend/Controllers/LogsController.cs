using Ec2Manager.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ec2Manager.Controllers;

[ApiController]
[Route("[controller]")]
[Authorize]
public class LogsController : ControllerBase
{
    private readonly AppDbContext _db;

    public LogsController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<object>> GetLogs(
        [FromQuery] string? accountKey,
        [FromQuery] string? region,
        [FromQuery] string? instanceId,
        [FromQuery] string? actionType,
        [FromQuery] string? result,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25)
    {
        var query = _db.AuditLogs.AsQueryable();

        if (!string.IsNullOrWhiteSpace(accountKey)) query = query.Where(l => l.AccountKey == accountKey);
        if (!string.IsNullOrWhiteSpace(region)) query = query.Where(l => l.Region == region);
        if (!string.IsNullOrWhiteSpace(actionType)) query = query.Where(l => l.ActionType == actionType);
        if (!string.IsNullOrWhiteSpace(result)) query = query.Where(l => l.Result == result);
        if (from != null) query = query.Where(l => l.Timestamp >= from);
        if (to != null) query = query.Where(l => l.Timestamp <= to);

        var all = await query.OrderByDescending(l => l.Timestamp).ToListAsync();

        if (!string.IsNullOrWhiteSpace(instanceId))
            all = all.Where(l => l.InstanceIds.Contains(instanceId)).ToList();

        var total = all.Count;
        var pageItems = all.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        return Ok(new { total, page, pageSize, items = pageItems });
    }
}
