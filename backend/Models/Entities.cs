namespace Ec2Manager.Models;

/// <summary>
/// A permanent application identity. This ID is what everything else in the
/// system (schedules, audit logs, permissions) refers to — it is never tied
/// to *how* the person authenticates. A user can have zero or more
/// ExternalIdentity rows (future SSO logins) and at most one Credential row
/// (local password), so switching or adding login methods later never
/// requires renumbering or merging application data.
/// </summary>
public class User
{
    public int Id { get; set; }

    /// <summary>Unique login handle for local auth. Not used as a foreign
    /// key anywhere else — Id is — so it can be changed freely.</summary>
    public string Username { get; set; } = "";

    /// <summary>Contact/display email. NEVER used as an identity key or to
    /// auto-link/merge accounts — two users can share an email transiently
    /// (e.g. during a provider migration) without collapsing into one.</summary>
    public string Email { get; set; } = "";

    public string DisplayName { get; set; } = "";

    /// <summary>"Admin" or "User". Kept on the application record, entirely
    /// independent of any identity provider — an external IdP's group
    /// membership is never trusted to imply an application role.</summary>
    public string Role { get; set; } = "User";

    /// <summary>Deactivated users fail login and are excluded from active
    /// checks, but their historical audit rows / CreatedBy references are
    /// preserved (nothing is deleted).</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "";
    public DateTime? LastLoginAt { get; set; }

    public Credential? Credential { get; set; }
    public List<ExternalIdentity> ExternalIdentities { get; set; } = new();
}

/// <summary>
/// Local-password credential, kept in its own table rather than on User so
/// that "how do we authenticate this person" is structurally separate from
/// "who is this person" — a prerequisite for adding OIDC providers later
/// without reshaping the User table. One-to-one with User; a user with no
/// row here simply cannot log in with a local password (e.g. an
/// SSO-only account created after external auth is introduced).
/// </summary>
public class Credential
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }

    public string PasswordHash { get; set; } = "";
    public DateTime PasswordUpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Set when an admin resets a password; forces the user to be
    /// aware their credential was changed by someone else. Not currently
    /// enforced as a forced-change-on-next-login flow (no UI for that yet),
    /// but the field is here so that flow can be added without a schema
    /// change.</summary>
    public bool MustChangePassword { get; set; } = false;
}

/// <summary>
/// A stable identity a user has proven ownership of via an external
/// identity provider. Not used yet (no provider is wired up), but the
/// application's user/permission model is built around this table existing
/// from day one, so introducing Entra ID / Google / Microsoft personal
/// accounts later only means: (1) validate their OIDC token, (2) look up or
/// create a row here, (3) resolve to the existing User.Id — no changes to
/// User, Schedule, AuditLog, or any authorization logic.
///
/// (Provider, ProviderUserId) is unique: the provider's own stable subject
/// identifier (OIDC "sub" claim), NEVER the email address, is the identity
/// key — so a changed email at the IdP does not break the link, and two
/// different provider accounts that happen to share an email are never
/// silently treated as the same person.
/// </summary>
public class ExternalIdentity
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }

    /// <summary>"EntraId", "EntraExternalId", "MicrosoftPersonal", "Google", etc.</summary>
    public string Provider { get; set; } = "";

    /// <summary>The provider's stable subject identifier (OIDC `sub`), not email.</summary>
    public string ProviderUserId { get; set; } = "";

    /// <summary>Email as reported by the provider at link time — informational
    /// only, never used for lookups or auto-linking.</summary>
    public string? ProviderEmail { get; set; }

    public DateTime LinkedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}

public class Schedule
{
    public int Id { get; set; }

    public string Name { get; set; } = "";
    public string AccountKey { get; set; } = "";

    // Stored as JSON strings in DB (Pomelo/MySQL doesn't natively support List<T> columns)
    public List<string> Regions { get; set; } = new();
    public List<string> InstanceIds { get; set; } = new(); // empty = all matching filters

    public string Action { get; set; } = "Start"; // "Start" or "Stop"

    // Time window
    public DateTimeOffset? ValidFrom { get; set; }
    public DateTimeOffset? ValidTo { get; set; }

    // Recurrence (windowed mode)
    public string? RecurrenceType { get; set; } // "None", "Daily", "Weekly"
    public List<string>? DaysOfWeek { get; set; } // e.g. ["Mon","Wed","Fri"]
    public TimeSpan? TimeOfDay { get; set; }

    // Cron mode (mutually exclusive with recurrence fields)
    public string? CronExpression { get; set; }

    public bool Enabled { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "";

    // Bookkeeping for the background runner so we don't double-fire in the
    // same minute if the poll interval and schedule granularity overlap.
    public DateTime? LastFiredAt { get; set; }
}

public class AuditLog
{
    public int Id { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    public int? UserId { get; set; }
    public string UserName { get; set; } = "";

    // ManualStart, ManualStop, ScheduleStart, ScheduleStop,
    // UserCreated, UserUpdated, UserActivated, UserDeactivated, UserDeleted,
    // PasswordReset, AdminBootstrap, Login, LoginFailed
    public string ActionType { get; set; } = "";
    public string AccountKey { get; set; } = "";
    public string Region { get; set; } = "";

    public List<string> InstanceIds { get; set; } = new();

    public bool DryRun { get; set; }
    public string Result { get; set; } = ""; // Success, Failed, Partial
    public string Message { get; set; } = "";
    public string? Error { get; set; }
}
