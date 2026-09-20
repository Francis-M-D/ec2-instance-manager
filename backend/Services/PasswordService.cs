using System.Security.Cryptography;

namespace Ec2Manager.Services;

/// <summary>
/// Centralizes password hashing/verification and policy so both
/// UsersController (admin-set/reset passwords) and any future self-service
/// flow use identical rules.
/// </summary>
public class PasswordService
{
    private const int MinLength = 12;

    public string Hash(string plaintextPassword) => BCrypt.Net.BCrypt.HashPassword(plaintextPassword, workFactor: 12);

    public bool Verify(string plaintextPassword, string hash) => BCrypt.Net.BCrypt.Verify(plaintextPassword, hash);

    /// <summary>Returns a list of validation errors; empty list means the
    /// password is acceptable. Intentionally not configurable via request
    /// input — policy is enforced server-side only.</summary>
    public List<string> Validate(string password)
    {
        var errors = new List<string>();
        if (string.IsNullOrEmpty(password) || password.Length < MinLength)
            errors.Add($"Password must be at least {MinLength} characters long");
        if (!password.Any(char.IsUpper))
            errors.Add("Password must contain at least one uppercase letter");
        if (!password.Any(char.IsLower))
            errors.Add("Password must contain at least one lowercase letter");
        if (!password.Any(char.IsDigit))
            errors.Add("Password must contain at least one digit");
        return errors;
    }

    /// <summary>Generates a random password meeting the policy above, for
    /// admin-initiated resets where the admin wants a system-generated
    /// temporary password rather than typing one.</summary>
    public string GenerateRandom(int length = 16)
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
        var bytes = RandomNumberGenerator.GetBytes(length);
        var result = new char[length];
        for (var i = 0; i < length; i++)
            result[i] = chars[bytes[i] % chars.Length];
        // Guarantee policy compliance regardless of random draw.
        return "Aa1" + new string(result)[3..];
    }
}
