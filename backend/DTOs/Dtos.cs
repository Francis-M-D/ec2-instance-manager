namespace Ec2Manager.DTOs;

public record TagDto(string Key, string Value);

public record CloudInstanceDto(
    string InstanceId,
    string Name,
    string State,
    List<TagDto> Tags,
    bool DnsEnabled,
    string? PublicIp,
    string? PrivateIp,
    string Region,
    string AccountKey,
    string? LaunchTime,
    string? InstanceType);

public record ActionSkipDto(string InstanceId, string Reason);

public record CloudActionResultDto(
    List<string>? WouldStart = null,
    List<string>? WouldStop = null,
    List<ActionSkipDto>? WouldSkip = null,
    List<Dictionary<string, object>>? Errors = null);

// ---- Instance list response shape returned by our own API ----
public record InstanceListItemDto(
    string InstanceId,
    string Name,
    string State,
    bool DnsEnabled,
    string? PublicIp,
    string? PrivateIp,
    string Region,
    string AccountKey,
    string? LaunchTime,
    string? InstanceType);

public record InstanceDetailDto(
    string InstanceId,
    string Name,
    string State,
    bool DnsEnabled,
    string? PublicIp,
    string? PrivateIp,
    string Region,
    string AccountKey,
    string? LaunchTime,
    string? InstanceType,
    List<TagDto> Tags);

// ---- Start/stop request/response ----
public record InstanceActionRequest(string AccountKey, string Region, List<string> InstanceIds, bool DryRun = false);

public record InstanceActionResponse(
    List<string> WouldStart,
    List<string> WouldStop,
    List<ActionSkipDto> WouldSkip,
    List<Dictionary<string, object>> Errors);

// Auth DTOs (LoginRequest, AuthResponse, MeResponse) live in UserDtos.cs
// alongside the admin-managed user model. Public registration has been
// removed by design — see DTOs/UserDtos.cs and Controllers/UsersController.cs.

// ---- Schedules ----
public record ScheduleCreateRequest(
    string Name,
    string AccountKey,
    List<string> Regions,
    List<string> InstanceIds,
    string Action,
    DateTimeOffset? ValidFrom,
    DateTimeOffset? ValidTo,
    string? RecurrenceType,
    List<string>? DaysOfWeek,
    TimeSpan? TimeOfDay,
    string? CronExpression,
    bool Enabled);

public record ScheduleDryRunPreview(DateTimeOffset NextRunAt, List<string> AffectedInstanceIds, List<string> SkippedInstanceIds);
