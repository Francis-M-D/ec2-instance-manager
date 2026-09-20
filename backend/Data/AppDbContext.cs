using System.Text.Json;
using Ec2Manager.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Ec2Manager.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Credential> Credentials => Set<Credential>();
    public DbSet<ExternalIdentity> ExternalIdentities => Set<ExternalIdentity>();
    public DbSet<Schedule> Schedules => Set<Schedule>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var stringListComparer = new ValueComparer<List<string>>(
            (a, b) => (a ?? new()).SequenceEqual(b ?? new()),
            v => v == null ? 0 : v.Aggregate(0, (h, s) => HashCode.Combine(h, s.GetHashCode())),
            v => v.ToList());

        modelBuilder.Entity<User>(e =>
        {
            // Username is the local login handle — unique, but NOT used as a
            // foreign key anywhere else (Id is), so it can be renamed freely.
            e.HasIndex(u => u.Username).IsUnique();

            // Email is deliberately NOT unique and NOT used as an identity
            // key: two accounts may transiently share an email during a
            // provider migration, and we never want that to silently merge
            // them. See ExternalIdentity for the actual identity model.
            e.HasIndex(u => u.Email);

            e.HasOne(u => u.Credential)
                .WithOne(c => c.User)
                .HasForeignKey<Credential>(c => c.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(u => u.ExternalIdentities)
                .WithOne(x => x.User)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ExternalIdentity>(e =>
        {
            // The real identity key for external logins: the provider's own
            // stable subject id, never email.
            e.HasIndex(x => new { x.Provider, x.ProviderUserId }).IsUnique();
        });

        modelBuilder.Entity<Schedule>(e =>
        {
            e.Property(s => s.Regions)
                .HasConversion(
                    v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                    v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new())
                .Metadata.SetValueComparer(stringListComparer);

            e.Property(s => s.InstanceIds)
                .HasConversion(
                    v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                    v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new())
                .Metadata.SetValueComparer(stringListComparer);

            e.Property(s => s.DaysOfWeek)
                .HasConversion(
                    v => v == null ? null : JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                    v => v == null ? null : JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null));
        });

        modelBuilder.Entity<AuditLog>(e =>
        {
            e.Property(a => a.InstanceIds)
                .HasConversion(
                    v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                    v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new())
                .Metadata.SetValueComparer(stringListComparer);

            e.HasIndex(a => a.Timestamp);
            e.HasIndex(a => a.AccountKey);
        });
    }
}
