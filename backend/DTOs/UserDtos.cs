namespace Ec2Manager.DTOs;

public record UserDto(
    int Id,
    string Username,
    string Email,
    string DisplayName,
    string Role,
    bool IsActive,
    DateTime CreatedAt,
    string CreatedBy,
    DateTime? LastLoginAt,
    List<string> ExternalProviders); // e.g. ["EntraId"] — empty for local-only accounts

public record CreateUserRequest(
    string Username,
    string Email,
    string DisplayName,
    string Role, // "Admin" or "User"
    string Password);

public record UpdateUserRequest(
    string Email,
    string DisplayName,
    string Role);

public record ResetPasswordRequest(
    // If null/empty, the server generates a random password meeting policy
    // and returns it once in the response (never stored or logged in plain
    // text anywhere else).
    string? NewPassword);

public record ResetPasswordResponse(string? GeneratedPassword);

public record LoginRequest(string Username, string Password);

public record AuthResponse(string Token, string Username, string Role);

public record MeResponse(int Id, string Username, string Email, string DisplayName, string Role);
