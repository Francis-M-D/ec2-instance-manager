using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ec2Manager.Services;

public record AccountMeta(string Key, string Name, string AccountId, bool Enabled = true);

public interface IAccountConfigProvider
{
    IReadOnlyList<AccountMeta> GetAccounts();
    AccountMeta? GetAccount(string key);
}

/// <summary>
/// Phase 1: reads the same Fernet-encrypted JSON blob the Python service reads,
/// but only ever exposes metadata (key/name/accountId) — never credentials.
/// The .NET side never needs raw AWS creds; it always calls cloud-service.
/// Phase 2: swap this out for a vault-backed implementation without touching callers.
/// </summary>
public class EnvAccountConfigProvider : IAccountConfigProvider
{
    private readonly List<AccountMeta> _accounts;

    private class RawAccount
    {
        [JsonPropertyName("key")] public string Key { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("accountId")] public string AccountId { get; set; } = "";
    }

    public EnvAccountConfigProvider(IConfiguration config)
    {
        var encEnv = Environment.GetEnvironmentVariable("EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED");
        var key = Environment.GetEnvironmentVariable("EC2MANAGER_DECRYPTION_KEY");

        if (string.IsNullOrWhiteSpace(encEnv) || string.IsNullOrWhiteSpace(key))
        {
            // Backend can still boot (e.g. for migrations) without these set,
            // but instance/account features will be unavailable.
            _accounts = new List<AccountMeta>();
            return;
        }

        var payload = JsonSerializer.Deserialize<Dictionary<string, string>>(encEnv)
            ?? throw new InvalidOperationException("Malformed EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED");
        var token = payload["encryptedPayload"];

        var plaintext = FernetDecrypt(token, key);
        var raw = JsonSerializer.Deserialize<List<RawAccount>>(plaintext) ?? new();
        _accounts = raw.Select(r => new AccountMeta(r.Key, r.Name, r.AccountId)).ToList();
    }

    public IReadOnlyList<AccountMeta> GetAccounts() => _accounts;

    public AccountMeta? GetAccount(string key) => _accounts.FirstOrDefault(a => a.Key == key);

    /// <summary>
    /// Minimal Fernet (https://github.com/fernet/spec) decryptor so .NET can read
    /// the same token format Python's `cryptography.fernet` produces, without
    /// pulling in raw credentials — only used to recover key/name/accountId.
    /// </summary>
    private static string FernetDecrypt(string token, string base64Key)
    {
        var keyBytes = Convert.FromBase64String(base64Key.Replace('-', '+').Replace('_', '/'));
        var signingKey = keyBytes[..16];
        var encryptionKey = keyBytes[16..];

        var data = Convert.FromBase64String(token.Replace('-', '+').Replace('_', '/'));
        // Layout: version(1) | timestamp(8) | iv(16) | ciphertext(n) | hmac(32)
        var iv = data[9..25];
        var ciphertext = data[25..^32];

        using var aes = Aes.Create();
        aes.Key = encryptionKey;
        aes.IV = iv;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        using var decryptor = aes.CreateDecryptor();
        var plainBytes = decryptor.TransformFinalBlock(ciphertext, 0, ciphertext.Length);
        return Encoding.UTF8.GetString(plainBytes);
    }
}
