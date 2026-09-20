using Cronos;
using Ec2Manager.Models;

namespace Ec2Manager.Services;

public static class ScheduleValidator
{
    public static List<string> Validate(Schedule s)
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(s.Name)) errors.Add("Name is required");
        if (string.IsNullOrWhiteSpace(s.AccountKey)) errors.Add("AccountKey is required");
        if (s.Action != "Start" && s.Action != "Stop") errors.Add("Action must be 'Start' or 'Stop'");

        if (s.ValidFrom == null) errors.Add("ValidFrom is required");
        if (s.ValidTo != null && s.ValidFrom != null && s.ValidTo < s.ValidFrom)
            errors.Add("ValidTo must be >= ValidFrom");

        var hasCron = !string.IsNullOrWhiteSpace(s.CronExpression);
        var hasRecurrence = !string.IsNullOrWhiteSpace(s.RecurrenceType) && s.RecurrenceType != "None";

        if (hasCron && hasRecurrence)
            errors.Add("CronExpression and windowed recurrence fields are mutually exclusive");

        if (hasCron)
        {
            try { CronExpression.Parse(s.CronExpression!, CronFormat.Standard); }
            catch { errors.Add("CronExpression is not a valid cron string"); }
        }
        else if (hasRecurrence)
        {
            if (s.RecurrenceType == "Weekly" && (s.DaysOfWeek == null || s.DaysOfWeek.Count == 0))
                errors.Add("DaysOfWeek must not be empty when RecurrenceType is 'Weekly'");

            if ((s.RecurrenceType == "Daily" || s.RecurrenceType == "Weekly") && s.TimeOfDay == null)
                errors.Add("TimeOfDay is required for Daily or Weekly recurrence");
        }
        else if (!hasCron)
        {
            // Neither cron nor recurrence -> treat as a one-off at ValidFrom, which is valid,
            // but RecurrenceType should be explicitly "None" for clarity.
        }

        return errors;
    }

    /// <summary>Computes the next N fire times within [ValidFrom, ValidTo], from `after`.</summary>
    public static List<DateTimeOffset> ComputeNextRuns(Schedule s, DateTimeOffset after, int count)
    {
        var results = new List<DateTimeOffset>();
        var windowEnd = s.ValidTo ?? DateTimeOffset.MaxValue;
        var windowStart = s.ValidFrom ?? after;

        if (!string.IsNullOrWhiteSpace(s.CronExpression))
        {
            var cron = CronExpression.Parse(s.CronExpression, CronFormat.Standard);
            var from = after > windowStart ? after : windowStart;
            var occurrences = cron.GetOccurrences(from.UtcDateTime, windowEnd.UtcDateTime, fromInclusive: false);
            foreach (var o in occurrences.Take(count))
                results.Add(new DateTimeOffset(o, TimeSpan.Zero));
            return results;
        }

        if (s.RecurrenceType == "Daily" || s.RecurrenceType == "Weekly")
        {
            var cursor = (after > windowStart ? after : windowStart).UtcDateTime.Date;
            var time = s.TimeOfDay ?? TimeSpan.Zero;
            var allowedDays = s.RecurrenceType == "Weekly"
                ? (s.DaysOfWeek ?? new()).Select(ParseDayOfWeek).ToHashSet()
                : Enum.GetValues<DayOfWeek>().ToHashSet();

            for (int i = 0; i < 400 && results.Count < count; i++)
            {
                var candidateDate = cursor.AddDays(i);
                if (candidateDate > windowEnd.UtcDateTime) break;
                if (!allowedDays.Contains(candidateDate.DayOfWeek)) continue;

                var candidate = new DateTimeOffset(candidateDate, TimeSpan.Zero) + time;
                if (candidate > after && candidate >= windowStart && candidate <= windowEnd)
                    results.Add(candidate);
            }
            return results;
        }

        // No recurrence -> one-off at ValidFrom
        if (s.ValidFrom != null && s.ValidFrom > after && s.ValidFrom <= windowEnd)
            results.Add(s.ValidFrom.Value);

        return results;
    }

    private static DayOfWeek ParseDayOfWeek(string abbrev) => abbrev.Trim().ToLowerInvariant() switch
    {
        "mon" => DayOfWeek.Monday,
        "tue" => DayOfWeek.Tuesday,
        "wed" => DayOfWeek.Wednesday,
        "thu" => DayOfWeek.Thursday,
        "fri" => DayOfWeek.Friday,
        "sat" => DayOfWeek.Saturday,
        "sun" => DayOfWeek.Sunday,
        _ => throw new ArgumentException($"Invalid day of week: {abbrev}"),
    };
}
