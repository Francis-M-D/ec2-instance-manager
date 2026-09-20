using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Ec2Manager.Models;
using Microsoft.IdentityModel.Tokens;

namespace Ec2Manager.Services;

public class JwtService
{
    private readonly string _secret;
    private readonly string _issuer;
    private readonly int _expiryMinutes;

    public JwtService(IConfiguration config)
    {
        _secret = Environment.GetEnvironmentVariable("EC2MANAGER_JWT_SECRET")
            ?? config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");
        _issuer = config["Jwt:Issuer"] ?? "ec2-manager";
        _expiryMinutes = int.TryParse(config["Jwt:ExpiryMinutes"], out var m) ? m : 60;
    }

    public string GenerateToken(User user)
    {
        // Sub is the app's own permanent internal user ID (User.Id) — not
        // the username, not any external provider's subject claim — so
        // authorization logic never has to change based on login method.
        // NameIdentifier mirrors Sub for ASP.NET Core's User.FindFirstValue
        // conventions used throughout the controllers.
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.Username),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role),
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _issuer,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_expiryMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
