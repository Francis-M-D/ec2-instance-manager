using System.Security.Claims;
using Ec2Manager.Data;
using Ec2Manager.DTOs;
using Ec2Manager.Models;
using Ec2Manager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ec2Manager.Controllers;

[ApiController]
[Route("[controller]")]
[Authorize]
public class SchedulesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly CloudServiceClient _cloud;

    public SchedulesController(AppDbContext db, CloudServiceClient cloud)
    {
        _db = db;
        _cloud = cloud;
    }

    private string CurrentUserName => User.FindFirstValue(ClaimTypes.Name)
        ?? User.Identity?.Name ?? "unknown";

    [HttpGet]
    public async Task<ActionResult<List<Schedule>>> GetAll() =>
        Ok(await _db.Schedules.OrderByDescending(s => s.CreatedAt).ToListAsync());

    [HttpGet("{id}")]
    public async Task<ActionResult<Schedule>> GetOne(int id)
    {
        var s = await _db.Schedules.FindAsync(id);
        return s == null ? NotFound() : Ok(s);
    }

    [HttpPost]
    public async Task<ActionResult<Schedule>> Create(ScheduleCreateRequest req)
    {
        var schedule = MapToEntity(req, new Schedule { CreatedBy = CurrentUserName });
        var errors = ScheduleValidator.Validate(schedule);
        if (errors.Count > 0) return BadRequest(new { errors });

        _db.Schedules.Add(schedule);
        await _db.SaveChangesAsync();
        return Ok(schedule);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<Schedule>> Update(int id, ScheduleCreateRequest req)
    {
        var existing = await _db.Schedules.FindAsync(id);
        if (existing == null) return NotFound();

        MapToEntity(req, existing);
        existing.UpdatedAt = DateTime.UtcNow;

        var errors = ScheduleValidator.Validate(existing);
        if (errors.Count > 0) return BadRequest(new { errors });

        await _db.SaveChangesAsync();
        return Ok(existing);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _db.Schedules.FindAsync(id);
        if (existing == null) return NotFound();
        _db.Schedules.Remove(existing);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id}/enable")]
    public async Task<IActionResult> Enable(int id) => await SetEnabled(id, true);

    [HttpPost("{id}/disable")]
    public async Task<IActionResult> Disable(int id) => await SetEnabled(id, false);

    private async Task<IActionResult> SetEnabled(int id, bool enabled)
    {
        var existing = await _db.Schedules.FindAsync(id);
        if (existing == null) return NotFound();
        existing.Enabled = enabled;
        existing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(existing);
    }

    [HttpPost("{id}/dryRun")]
    public async Task<ActionResult<List<ScheduleDryRunPreview>>> DryRun(int id, [FromQuery] int count = 3)
    {
        var s = await _db.Schedules.FindAsync(id);
        if (s == null) return NotFound();

        var nextRuns = ScheduleValidator.ComputeNextRuns(s, DateTimeOffset.UtcNow, count);
        var previews = new List<ScheduleDryRunPreview>();

        foreach (var runAt in nextRuns)
        {
            var affected = new List<string>();
            var skipped = new List<string>();

            foreach (var region in s.Regions.DefaultIfEmpty())
            {
                if (region == null) continue;
                var instances = s.InstanceIds.Count > 0
                    ? s.InstanceIds
                    : (await _cloud.ListInstancesAsync(s.AccountKey, region, null, null))
                        .Select(i => i.InstanceId).ToList();

                var result = s.Action == "Start"
                    ? await _cloud.StartInstancesAsync(s.AccountKey, region, instances, dryRun: true)
                    : await _cloud.StopInstancesAsync(s.AccountKey, region, instances, dryRun: true);

                affected.AddRange(s.Action == "Start" ? result.WouldStart ?? new() : result.WouldStop ?? new());
                skipped.AddRange((result.WouldSkip ?? new()).Select(x => x.InstanceId));
            }

            previews.Add(new ScheduleDryRunPreview(runAt, affected, skipped));
        }

        return Ok(previews);
    }

    private static Schedule MapToEntity(ScheduleCreateRequest req, Schedule target)
    {
        target.Name = req.Name;
        target.AccountKey = req.AccountKey;
        target.Regions = req.Regions ?? new();
        target.InstanceIds = req.InstanceIds ?? new();
        target.Action = req.Action;
        target.ValidFrom = req.ValidFrom;
        target.ValidTo = req.ValidTo;
        target.RecurrenceType = req.RecurrenceType;
        target.DaysOfWeek = req.DaysOfWeek;
        target.TimeOfDay = req.TimeOfDay;
        target.CronExpression = req.CronExpression;
        target.Enabled = req.Enabled;
        return target;
    }
}
