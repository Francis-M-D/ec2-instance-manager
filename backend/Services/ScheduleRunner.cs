using Cronos;
using Ec2Manager.Data;
using Ec2Manager.Models;
using Microsoft.EntityFrameworkCore;

namespace Ec2Manager.Services;

/// <summary>
/// Polls enabled schedules every ~15s and fires any whose next occurrence has
/// arrived. Re-checks the DNS tag policy at execution time (never relies on
/// data cached when the schedule was created).
/// </summary>
public class ScheduleRunner : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ScheduleRunner> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan FireTolerance = TimeSpan.FromSeconds(30);

    public ScheduleRunner(IServiceScopeFactory scopeFactory, ILogger<ScheduleRunner> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ScheduleRunner tick failed");
            }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (TaskCanceledException) { }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var cloud = scope.ServiceProvider.GetRequiredService<CloudServiceClient>();
        var audit = scope.ServiceProvider.GetRequiredService<AuditService>();

        var now = DateTimeOffset.UtcNow;
        var enabled = await db.Schedules.Where(s => s.Enabled).ToListAsync(ct);

        foreach (var schedule in enabled)
        {
            if (schedule.ValidFrom != null && now < schedule.ValidFrom) continue;
            if (schedule.ValidTo != null && now > schedule.ValidTo) continue;

            if (!ShouldFireNow(schedule, now)) continue;

            // Avoid double-firing within the same tolerance window.
            if (schedule.LastFiredAt != null &&
                (now - new DateTimeOffset(schedule.LastFiredAt.Value, TimeSpan.Zero)) < FireTolerance)
                continue;

            await FireAsync(schedule, cloud, audit, db, ct);
            schedule.LastFiredAt = now.UtcDateTime;
            await db.SaveChangesAsync(ct);
        }
    }

    private static bool ShouldFireNow(Schedule s, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(s.CronExpression))
        {
            var cron = CronExpression.Parse(s.CronExpression, CronFormat.Standard);
            var prev = cron.GetOccurrences(now.UtcDateTime.AddMinutes(-2), now.UtcDateTime, fromInclusive: false);
            return prev.Any();
        }

        if (s.RecurrenceType == "Daily" || s.RecurrenceType == "Weekly")
        {
            var time = s.TimeOfDay ?? TimeSpan.Zero;
            var nowTime = now.TimeOfDay;
            var withinMinute = Math.Abs((nowTime - time).TotalSeconds) < FireTolerance.TotalSeconds;
            if (!withinMinute) return false;

            if (s.RecurrenceType == "Weekly")
            {
                var allowed = (s.DaysOfWeek ?? new()).Select(d => d.Trim().ToLowerInvariant()).ToHashSet();
                var todayAbbrev = now.DayOfWeek.ToString()[..3].ToLowerInvariant();
                return allowed.Contains(todayAbbrev);
            }
            return true;
        }

        // One-off: fire once when now crosses ValidFrom.
        if (s.ValidFrom != null && s.LastFiredAt == null)
            return now >= s.ValidFrom && (now - s.ValidFrom) < FireTolerance;

        return false;
    }

    private static async Task FireAsync(
        Schedule schedule, CloudServiceClient cloud, AuditService audit, AppDbContext db, CancellationToken ct)
    {
        var regions = schedule.Regions.Count > 0 ? schedule.Regions : new List<string> { "" };

        foreach (var region in regions)
        {
            if (string.IsNullOrEmpty(region)) continue;

            var instanceIds = schedule.InstanceIds.Count > 0
                ? schedule.InstanceIds
                : (await cloud.ListInstancesAsync(schedule.AccountKey, region, null, null))
                    .Select(i => i.InstanceId).ToList();

            if (instanceIds.Count == 0) continue;

            var result = schedule.Action == "Start"
                ? await cloud.StartInstancesAsync(schedule.AccountKey, region, instanceIds, dryRun: false)
                : await cloud.StopInstancesAsync(schedule.AccountKey, region, instanceIds, dryRun: false);

            var acted = schedule.Action == "Start" ? result.WouldStart ?? new() : result.WouldStop ?? new();
            var skipped = result.WouldSkip ?? new();
            var errors = result.Errors ?? new();
            var outcome = errors.Count > 0 ? (acted.Count > 0 ? "Partial" : "Failed") : "Success";

            await audit.LogAsync(
                schedule.Action == "Start" ? "ScheduleStart" : "ScheduleStop",
                schedule.AccountKey, region, instanceIds, dryRun: false, outcome,
                $"Schedule '{schedule.Name}': {acted.Count} {(schedule.Action == "Start" ? "started" : "stopped")}, {skipped.Count} skipped",
                errors.Count > 0 ? string.Join("; ", errors.Select(e => e.ToString())) : null,
                userName: $"schedule:{schedule.Name}");
        }
    }
}
