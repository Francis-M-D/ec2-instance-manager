using System.Text;
using Ec2Manager.Data;
using Ec2Manager.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// ---------- Database ----------
var connectionString = Environment.GetEnvironmentVariable("EC2MANAGER_DB_CONNECTION")
    ?? builder.Configuration.GetConnectionString("Default")
    ?? "Server=localhost;Port=3306;Database=ec2manager;User=root;Password=root;";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));

// ---------- Services ----------
builder.Services.AddSingleton<IAccountConfigProvider, EnvAccountConfigProvider>();
builder.Services.AddScoped<JwtService>();
builder.Services.AddScoped<PasswordService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddHttpClient<CloudServiceClient>();
builder.Services.AddHostedService<ScheduleRunner>();
// Runs once at startup; creates the initial admin only if no users exist
// yet and EC2MANAGER_INITIAL_ADMIN_USERNAME/PASSWORD are set. See
// Services/AdminBootstrapService.cs for full behavior.
builder.Services.AddHostedService<AdminBootstrapService>();

// ---------- Auth ----------
var jwtSecret = Environment.GetEnvironmentVariable("EC2MANAGER_JWT_SECRET")
    ?? builder.Configuration["Jwt:Secret"]
    ?? "dev-only-insecure-secret-change-me-please-32bytes+";
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "ec2-manager";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtIssuer,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
builder.Services.AddAuthorization();

// ---------- CORS (frontend dev server) ----------
var frontendOrigin = Environment.GetEnvironmentVariable("EC2MANAGER_FRONTEND_ORIGIN") ?? "http://localhost:5173";
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(frontendOrigin).AllowAnyHeader().AllowAnyMethod());
});

// ---------- Controllers + Swagger ----------
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
