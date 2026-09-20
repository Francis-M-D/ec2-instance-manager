using Ec2Manager.Data;
using Ec2Manager.Models;

namespace Ec2Manager.Services;

public class AuditService
{
    private readonly AppDbContext _db;

    public AuditService(AppDbContext db)
    {
        _db = db;
    }

    public async Task LogAsync(
        string actionType,
        string accountKey,
        string region,
        List<string> instanceIds,
        bool dryRun,
        string result,
        string message,
        string? error = null,
        int? userId = null,
        string userName = "")
    {
        _db.AuditLogs.Add(new AuditLog
        {
            Timestamp = DateTime.UtcNow,
            UserId = userId,
            UserName = userName,
            ActionType = actionType,
            AccountKey = accountKey,
            Region = region,
            InstanceIds = instanceIds,
            DryRun = dryRun,
            Result = result,
            Message = message,
            Error = error,
        });
        await _db.SaveChangesAsync();
    }
}
