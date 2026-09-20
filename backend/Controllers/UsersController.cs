using System.Security.Claims;
using Ec2Manager.Data;
using Ec2Manager.DTOs;
using Ec2Manager.Models;
using Ec2Manager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ec2Manager.Controllers;

/// <summary>
/// User account management. Every endpoint requires the Admin role — this
/// is the only way accounts get created, since public registration does
/// not exist. All mutations are audit-logged.
/// </summary>
[ApiController]
[Route("[controller]")]
[Authorize(Roles = "Admin")]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PasswordService _passwords;
    private readonly AuditService _audit;

    public UsersController(AppDbContext db, PasswordService passwords, AuditService audit)
    {
        _db = db;
        _passwords = passwords;
        _audit = audit;
    }

    private int CurrentUserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private string CurrentUserName => User.FindFirstValue(ClaimTypes.Name) ?? "unknown";

    private static UserDto ToDto(User u) => new(
        u.Id, u.Username, u.Email, u.DisplayName, u.Role, u.IsActive, u.CreatedAt, u.CreatedBy, u.LastLoginAt,
        u.ExternalIdentities.Select(x => x.Provider).Distinct().ToList());

    [HttpGet]
    public async Task<ActionResult<List<UserDto>>> GetAll()
    {
        var users = await _db.Users.Include(u => u.ExternalIdentities).OrderBy(u => u.Username).ToListAsync();
        return Ok(users.Select(ToDto).ToList());
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<UserDto>> GetOne(int id)
    {
        var user = await _db.Users.Include(u => u.ExternalIdentities).FirstOrDefaultAsync(u => u.Id == id);
        return user == null ? NotFound() : Ok(ToDto(user));
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create(CreateUserRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username))
            return BadRequest(new { errors = new[] { "Username is required" } });
        if (req.Role != "Admin" && req.Role != "User")
            return BadRequest(new { errors = new[] { "Role must be 'Admin' or 'User'" } });

        var pwErrors = _passwords.Validate(req.Password);
        if (pwErrors.Count > 0) return BadRequest(new { errors = pwErrors });

        if (await _db.Users.AnyAsync(u => u.Username == req.Username))
            return Conflict(new { errors = new[] { "Username is already in use" } });

        var user = new User
        {
            Username = req.Username,
            Email = req.Email,
            DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? req.Username : req.DisplayName,
            Role = req.Role,
            IsActive = true,
            CreatedBy = CurrentUserName,
        };
        user.Credential = new Credential { PasswordHash = _passwords.Hash(req.Password) };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            "UserCreated", accountKey: "", region: "", instanceIds: new List<string>(), dryRun: false,
            result: "Success", message: $"User '{user.Username}' (role: {user.Role}) created.",
            userId: CurrentUserId, userName: CurrentUserName);

        return Ok(ToDto(user));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<UserDto>> Update(int id, UpdateUserRequest req)
    {
        var user = await _db.Users.Include(u => u.ExternalIdentities).FirstOrDefaultAsync(u => u.Id == id);
        if (user == null) return NotFound();

        if (req.Role != "Admin" && req.Role != "User")
            return BadRequest(new { errors = new[] { "Role must be 'Admin' or 'User'" } });

        // Prevent an admin from demoting themselves and locking everyone out.
        if (user.Id == CurrentUserId && req.Role != "Admin")
            return BadRequest(new { errors = new[] { "You cannot change your own role away from Admin" } });

        user.Email = req.Email;
        user.DisplayName = req.DisplayName;
        user.Role = req.Role;
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            "UserUpdated", accountKey: "", region: "", instanceIds: new List<string>(), dryRun: false,
            result: "Success", message: $"User '{user.Username}' updated (role: {user.Role}).",
            userId: CurrentUserId, userName: CurrentUserName);

        return Ok(ToDto(user));
    }

    [HttpPost("{id}/activate")]
    public Task<IActionResult> Activate(int id) => SetActive(id, true);

    [HttpPost("{id}/deactivate")]
    public Task<IActionResult> Deactivate(int id) => SetActive(id, false);

    private async Task<IActionResult> SetActive(int id, bool active)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound();

        if (user.Id == CurrentUserId && !active)
            return BadRequest(new { errors = new[] { "You cannot deactivate your own account" } });

        user.IsActive = active;
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            active ? "UserActivated" : "UserDeactivated", accountKey: "", region: "",
            instanceIds: new List<string>(), dryRun: false, result: "Success",
            message: $"User '{user.Username}' {(active ? "activated" : "deactivated")}.",
            userId: CurrentUserId, userName: CurrentUserName);

        return Ok(ToDto(user));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound();

        if (user.Id == CurrentUserId)
            return BadRequest(new { errors = new[] { "You cannot delete your own account" } });

        var username = user.Username;
        _db.Users.Remove(user); // Credential/ExternalIdentity cascade; AuditLogs keep UserName as a historical string
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            "UserDeleted", accountKey: "", region: "", instanceIds: new List<string>(), dryRun: false,
            result: "Success", message: $"User '{username}' deleted.",
            userId: CurrentUserId, userName: CurrentUserName);

        return NoContent();
    }

    [HttpPost("{id}/reset-password")]
    public async Task<ActionResult<ResetPasswordResponse>> ResetPassword(int id, ResetPasswordRequest req)
    {
        var user = await _db.Users.Include(u => u.Credential).FirstOrDefaultAsync(u => u.Id == id);
        if (user == null) return NotFound();

        string newPassword;
        string? returnedPassword = null;
        if (string.IsNullOrWhiteSpace(req.NewPassword))
        {
            newPassword = _passwords.GenerateRandom();
            returnedPassword = newPassword; // only time it's ever returned in plaintext
        }
        else
        {
            var errors = _passwords.Validate(req.NewPassword);
            if (errors.Count > 0) return BadRequest(new { errors });
            newPassword = req.NewPassword;
        }

        if (user.Credential == null)
        {
            user.Credential = new Credential { PasswordHash = _passwords.Hash(newPassword) };
            _db.Credentials.Add(user.Credential);
        }
        else
        {
            user.Credential.PasswordHash = _passwords.Hash(newPassword);
            user.Credential.PasswordUpdatedAt = DateTime.UtcNow;
            user.Credential.MustChangePassword = true;
        }
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            "PasswordReset", accountKey: "", region: "", instanceIds: new List<string>(), dryRun: false,
            result: "Success", message: $"Password reset for user '{user.Username}' by admin.",
            userId: CurrentUserId, userName: CurrentUserName);

        return Ok(new ResetPasswordResponse(returnedPassword));
    }
}
