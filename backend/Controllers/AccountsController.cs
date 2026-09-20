using Ec2Manager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ec2Manager.Controllers;

[ApiController]
[Route("[controller]")]
[Authorize]
public class AccountsController : ControllerBase
{
    private readonly IAccountConfigProvider _accounts;

    public AccountsController(IAccountConfigProvider accounts)
    {
        _accounts = accounts;
    }

    [HttpGet]
    public ActionResult<IReadOnlyList<AccountMeta>> GetAccounts()
    {
        // Never returns credentials — metadata only.
        return Ok(_accounts.GetAccounts());
    }
}
