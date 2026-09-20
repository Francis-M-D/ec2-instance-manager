using System.Security.Claims;
using Ec2Manager.Data;
using Ec2Manager.DTOs;
using Ec2Manager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ec2Manager.Controllers;

/// <summary>
/// Local authentication only. There is deliberately NO public /register
/// endpoint — accounts are created exclusively by an administrator via
/// UsersController, or (once the initial admin exists) by the one-time
/// AdminBootstrapService. This is the "future-ready" seam for external
/// login: when an OIDC provider is added, it gets its own endpoint here
/// (e.g. POST /auth/oidc/callback) that resolves to an existing User.Id via
/// ExternalIdentity and calls the same JwtService.GenerateToken — nothing
/// about Login/Me or the rest of the app needs to change.
/// </summary>
[ApiController]
[Route("[controller]")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly JwtService _jwt;
    private readonly PasswordService _passwords;
    private readonly AuditService _audit;

    public AuthController(AppDbContext db, JwtService jwt, PasswordService passwords, AuditService audit)
    {
        _db = db;
        _jwt = jwt;
        _passwords = passwords;
        _audit = audit;
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var user = await _db.Users
            .Include(u => u.Credential)
            .FirstOrDefaultAsync(u => u.Username == req.Username);

        // Same generic error whether the username doesn't exist, the
        // account has no local credential (e.g. SSO-only in the future), the
        // password is wrong, or the account is deactivated — never reveal
        // which case it was.
        if (user == null || user.Credential == null || !user.IsActive ||
            !_passwords.Verify(req.Password, user.Credential.PasswordHash))
        {
            await _audit.LogAsync(
                "LoginFailed", accountKey: "", region: "", instanceIds: new List<string>(), dryRun: false,
                result: "Failed", message: $"Failed login attempt for username '{req.Username}'.",
                userName: req.Username);
            return Unauthorized("Invalid credentials");
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.LogAsync(
            "Login", accountKey: "", region: "", instanceIds: new List<string>(), dryRun: false,
            result: "Success", message: $"User '{user.Username}' logged in.",
            userId: user.Id, userName: user.Username);

        return Ok(new AuthResponse(_jwt.GenerateToken(user), user.Username, user.Role));
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<MeResponse>> Me()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await _db.Users.FindAsync(userId);
        if (user == null || !user.IsActive) return Unauthorized();
        return Ok(new MeResponse(user.Id, user.Username, user.Email, user.DisplayName, user.Role));
    }
}
