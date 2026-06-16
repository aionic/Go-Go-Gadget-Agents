# Best practices

Security, networking, and operational guidance for running Go-Go-Gadget-Agents beyond a demo.
For the deploy mechanics, see [deployment.md](deployment.md); for the rationale, see
[design.md](design.md).

## Identity & secrets

- **Stay passwordless.** Service-to-service auth uses Entra ID + the shared managed identity; keep
  local/key auth disabled on Storage, Search, and Cognitive Services where supported.
- **Least privilege by stable GUID.** Grant the minimum built-in role and reference roles by GUID,
  not display name (Foundry role names differ per tenant). See [rbac.md](rbac.md).
- **Rotate the Entra client secret.** It's stored as a native Container App secret. Rotate on a
  schedule, update `terraform.tfvars` (gitignored), and re-apply. If a secret was ever set as a
  plaintext env value on a prior revision, treat it as exposed and rotate.
- **Keep secrets out of git.** Only `*.example` files are tracked; `terraform.tfvars` and
  `agent-ui/.env.local` are gitignored. Verify before every commit.

## Networking

- **Private endpoints for data services.** Cosmos already uses a private endpoint. Add private
  endpoints for **Key Vault** and **PostgreSQL** (and link their private DNS zones to the CAE VNet)
  so the secret can move from a native Container App secret to **Key Vault**, and Postgres seeding
  can run inside the network.
- **Run post-provision inside the network.** In governed subscriptions with public access disabled,
  run `seed.py` / `configure_foundry_iq.py` from **within** the VNet (e.g. a Container App job or
  ACI using the shared identity) rather than from a developer workstation. Toggle
  `run_postgres_seed = false` when seeding can't reach Postgres publicly.
- **Prefer RBAC-only over IP firewalls on corpnet.** Corpnet egress IPs vary by destination, so
  single-IP Search firewall rules are unreliable — set `restrict_public_ip = false`.

## Policy-governed subscriptions (MCAPS and similar)

Observed Azure Policy / deny-assignment constraints and how to handle them:

| Constraint | Effect | Handling |
|------------|--------|----------|
| Key Vault & Postgres `publicNetworkAccess` forced **Disabled** | Deployer/app can't reach them publicly | Private endpoints; native CA secret; `run_postgres_seed = false` + in-network seed |
| Cognitive Services `disableLocalAuth` forced **true** | No key auth | Use Entra/RBAC only (the default here) |
| Cosmos **deny assignment** on `listKeys` | Even Owner can't read keys | Passwordless (AAD) Cosmos access; expect key-based outputs to error on plan refresh |
| Corpnet egress IP varies | Single-IP firewall rules flaky | `restrict_public_ip = false` (RBAC-only Search) |
| **PIM** Owner is time-boxed | Expires mid-session | Re-elevate before long applies (see the `pim-elevate` workflow) |

## Hosted agents

- **Valid sandbox sizes only:** `0.5 vCPU / 1 GiB`, `1 vCPU / 2 GiB`, `2 vCPU / 4 GiB`. (`0.25` is
  invalid and causes an ImageError.) Oversizing multiplies cost by concurrency.
- **Billing is per active session** (15-min idle timeout, 30-day max) — right-size for concurrency.
- **Keep `mcp` in `requirements.txt`.** The hosting layer imports `from mcp import McpError`; dropping
  it makes the container crash on startup (readiness never 200, invokes return HTTP 424).
- **ACR must stay public-reachable** for image pulls even in network-isolated Foundry (private ACR
  is unsupported for the agent platform).
- **Diagnose readiness** with `azd ai agent monitor <name> --tail N`.

## Operations

- **Use a remote state backend.** State is local by default; switch to a remote `azurerm` backend
  for shared/team use and locking.
- **Verify model availability per region.** `gpt-5.4-mini` / `text-embedding-3-large` may only be in
  select regions — hence the separate `foundry_location`. Check with
  `az cognitiveservices model list`.
- **Observability is wired.** App Insights connection string is injected into the UI and agents;
  OTel traces flow to Application Insights → Log Analytics. Use it for latency and failure triage.
- **DNS gotcha (clients):** corpnet resolvers can intermittently fail to resolve
  `*.azurecontainerapps.io`. If the UI "won't load" but the app is healthy, `ipconfig /flushdns`,
  try a non-corpnet network, or pin a hosts entry to the CAE static IP.

---

↩ Back to the [documentation hub](README.md) · Related: [rbac.md](rbac.md) · [deployment.md](deployment.md) · [design.md](design.md)
