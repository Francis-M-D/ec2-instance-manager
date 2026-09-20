using Ec2Manager.Data;
using Ec2Manager.Models;
using Microsoft.EntityFrameworkCore;

namespace Ec2Manager.Services;

/// <summary>
/// Runs once at application startup. If no users exist yet, it creates the
/// initial administrator — but ONLY from an explicit password supplied via
/// environment variable, never from a hardcoded or auto-generated-and-hidden
/// default. This keeps bootstrap both secure (no default credential ever
/// exists in the codebase or image) and auditable (the admin sets their own
/// password up front, and the action is written to the audit log).
///
/// Behavior:
///   - Users table has >=1 row: does nothing, ever again. Bootstrap is a
///     one-time operation by design — re-running the app never touches it.
///   - Users table is empty AND EC2MANAGER_INITIAL_ADMIN_USERNAME /
///     EC2MANAGER_INITIAL_ADMIN_PASSWORD are both set: creates that admin,
///     validated against the same password policy as everyone else, then
///     logs a clear one-time success message recommending the env vars be
///     unset/removed from the environment afterward.
///   - Users table is empty AND those env vars are NOT set: logs a clear,
///     repeating warning with exact instructions, and the app continues to
///     run (so operators can fix env vars and restart without a full
///     redeploy) — no user can log in until this is resolved, which is the
///     intended fail-closed behavior (no public registration exists).
/// </summary>
public class AdminBootstrapService : IHostedService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AdminBootstrapService> _logger;

    public AdminBootstrapService(IServiceScopeFactory scopeFactory, ILogger<AdminBootstrapService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var passwords = scope.ServiceProvider.GetRequiredService<PasswordService>();
        var audit = scope.ServiceProvider.GetRequiredService<AuditService>();

        // Migrations may not have run yet in a fresh environment; don't
        // crash the whole app if the Users table doesn't exist yet.
        bool anyUsers;
        try
        {
            anyUsers = await db.Users.AnyAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AdminBootstrapService could not query Users (has the database been migrated yet?). Skipping bootstrap check for this run.");
            return;
        }

        if (anyUsers) return;

        var username = Environment.GetEnvironmentVariable("EC2MANAGER_INITIAL_ADMIN_USERNAME");
        var password = Environment.GetEnvironmentVariable("EC2MANAGER_INITIAL_ADMIN_PASSWORD");
        var email = Environment.GetEnvironmentVariable("EC2MANAGER_INITIAL_ADMIN_EMAIL") ?? "";

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            _logger.LogWarning(
                "No users exist yet and no admin account can be created: set EC2MANAGER_INITIAL_ADMIN_USERNAME " +
                "and EC2MANAGER_INITIAL_ADMIN_PASSWORD (and optionally EC2MANAGER_INITIAL_ADMIN_EMAIL), then " +
                "restart the backend. Public registration is disabled by design, so this is the only way in.");
            return;
        }

        var errors = passwords.Validate(password);
        if (errors.Count > 0)
        {
            _logger.LogError(
                "EC2MANAGER_INITIAL_ADMIN_PASSWORD does not meet the password policy: {Errors}. " +
                "Fix the env var and restart.", string.Join("; ", errors));
            return;
        }

        var admin = new User
        {
            Username = username,
            Email = email,
            DisplayName = username,
            Role = "Admin",
            IsActive = true,
            CreatedBy = "bootstrap",
        };
        admin.Credential = new Credential
        {
            PasswordHash = passwords.Hash(password),
        };

        db.Users.Add(admin);
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync(
            "AdminBootstrap", accountKey: "", region: "", instanceIds: new List<string>(), dryRun: false,
            result: "Success", message: $"Initial administrator '{username}' created via environment bootstrap.",
            userId: admin.Id, userName: "bootstrap");

        _logger.LogWarning(
            "Initial administrator account '{Username}' created successfully. " +
            "For security, remove EC2MANAGER_INITIAL_ADMIN_PASSWORD from the environment now — " +
            "it is no longer needed and bootstrap will never run again while any user exists.",
            username);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
