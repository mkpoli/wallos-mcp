# wallos-mcp — specification

An MCP server that puts a self-hosted [Wallos](https://github.com/ellite/Wallos)
subscription tracker behind the Model Context Protocol, running as a Cloudflare
Worker the operator deploys themselves.

## 1. What it talks to

Wallos v5 (v5.0, 2026-07-11) introduced an HTTP API authenticated by a per-user
API key. Everything this server does goes through it. The full endpoint contract
— parameters, response shapes, which superglobal each endpoint reads — is in
[docs/wallos-api.md](docs/wallos-api.md), generated from the v5.2.0 sources.

Four properties of that API decide the shape of the client:

- **Reads** (`get_*`) read `$_REQUEST`, so the key travels as a GET query
  parameter or a POST form field. Send them as POST form bodies: a key in a
  query string ends up in access logs and proxy history.
- **Writes** (`set_*`) read `$_POST` only. In PHP that means the body must be
  `application/x-www-form-urlencoded` or `multipart/form-data`. A JSON body
  arrives as an empty `$_POST` and the endpoint answers "Missing API key".
- **Every response is HTTP 200**, including authentication failures and
  validation errors. Success is `success: false` in the JSON body with `title`
  and `message`. A client that branches on the status code is broken.
- **One key, one Wallos user.** The key resolves to a row in `user`; the
  endpoints scope their queries to that user id. Admin endpoints additionally
  check the user's admin flag.

Wallos versions differ in which endpoints exist. `api/subscriptions/get_period_budget.php`
and `api/users/set_budget.php` landed after v5.2.0. Read
`api/status/version.php` when a session opens and register version-gated tools
only when the instance is new enough; a tool that always 404s is worse than one
that is absent.

## 2. Authentication and multi-tenancy

The Worker is an OAuth 2.1 authorization server to its MCP clients
(`@cloudflare/workers-oauth-provider`), the same arrangement gmail-mcp uses. It
has no upstream OAuth to delegate to, because Wallos issues API keys rather than
tokens, so the sign-in step is a form:

1. `GET /authorize` — parse the auth request, look the client up, and show the
   approval dialog for a client this browser has not approved before.
2. The sign-in page asks for the **Wallos base URL** and the **API key**
   (Wallos: Settings → your profile → API key).
3. The Worker validates the pair by calling `api/users/get_user.php`. A
   `success: false` answer, a non-JSON answer (a login page means the URL points
   at something other than a Wallos instance), or a host outside `ALLOWED_HOSTS`
   ends the flow with an explanation rather than a grant.
4. `completeAuthorization` stores the props below; the encrypted grant lives in
   `OAUTH_KV`, and the API key never reaches the MCP client.

```ts
type Props = {
  baseUrl: string;   // origin + optional path prefix, no trailing slash
  apiKey: string;
  userId: number;
  username: string;
  email: string;
  version: string;   // instance version read at sign-in
};
```

`ALLOWED_HOSTS` gates which instances may be bound: a comma-separated list of
hosts, `*.example.com`, or `*` for any. Empty admits nobody. `MAX_ACCOUNTS`
caps how many distinct (host, user id) pairs may ever complete sign-in.

A Durable Object per grant holds the session (`WallosMCP extends McpAgent`).
The bound account is carried from the OAuth boundary to the object on a header
the Worker sets after stripping any inbound copy, and the object refuses to
start on a grant that does not own it.

## 3. Tool surface

Every tool answers with JSON text. Errors from Wallos surface as the `title` and
`message` the instance returned, never as a bare "request failed", and never
with the API key in the message.

### Session

| Tool | Wallos endpoint |
| --- | --- |
| `whoami` | `api/users/get_user.php`, `api/status/version.php` |

Reports the bound instance, the Wallos user, the version, and which
version-gated tools are active.

### Subscriptions

| Tool | Wallos endpoint |
| --- | --- |
| `list_subscriptions` | `api/subscriptions/get_subscriptions.php` |
| `get_subscription` | `api/subscriptions/get_subscription.php` |
| `create_subscription` | `api/subscriptions/set_subscriptions.php` `action=add` |
| `update_subscription` | `action=edit` |
| `delete_subscription` | `action=delete` |
| `get_monthly_cost` | `api/subscriptions/get_monthly_cost.php` |
| `get_ical_feed` | `api/subscriptions/get_ical_feed.php` |
| `get_period_budget` | `api/subscriptions/get_period_budget.php` (version-gated) |

`list_subscriptions` exposes the endpoint's filters: `member` (ids),
`category`, `payment_method`, `state` (`active` / `inactive` — the wire values
are inverted, 0 is active), `sort`, `disabled_to_bottom`, `convert_currency`,
`all_user_subscriptions`.

### Master data

| Tool | Wallos endpoint |
| --- | --- |
| `get_master_data` | the four `get_` endpoints below, in one call |
| `create_category` / `update_category` / `delete_category` | `api/categories/set_categories.php` |
| `create_payment_method` / `update_payment_method` / `delete_payment_method` | `api/payment_methods/set_payment_methods.php` |
| `create_household_member` / `update_household_member` / `delete_household_member` | `api/household/set_household.php` |
| `create_currency` / `update_currency` / `delete_currency` | `api/currencies/set_currencies.php` |

`get_master_data` returns categories, currencies, payment methods and household
members together, because every subscription write needs ids from all four.

### Settings

| Tool | Wallos endpoint |
| --- | --- |
| `get_settings` / `update_settings` | `api/settings/*` |
| `get_notification_settings` | `api/notifications/get_notification_settings.php` |
| `get_fixer_settings` / `update_fixer_settings` | `api/fixer/*` |

### Administration — registered only when `ADMIN_TOOLS` is `"1"`

| Tool | Wallos endpoint |
| --- | --- |
| `get_admin_settings` / `update_admin_settings` | `api/admin/*_admin_settings.php` |
| `get_oidc_settings` / `update_oidc_settings` | `api/admin/*_oidc_settings.php` |
| `set_password_login_disabled` | `api/admin/set_disable_password_login.php` |

These rewrite how everyone signs in to the instance. Off by default.

## 4. The convenience layer

The API takes integer ids; an assistant has names. `create_subscription` and
`update_subscription` therefore accept both, and resolve names against master
data:

- `category_name`, `payment_method_name`, `payer_name`, `currency_code`
  (ISO 4217 code) — matched case-insensitively against the instance's own lists.
- A name with no match is created through the corresponding `set_` endpoint when
  `create_missing` is true (the default), and is an error naming the available
  options when it is false.
- An explicit `*_id` always wins over the matching name.
- The instance's main currency is the fallback when neither currency argument is
  given.

Billing period: the wire fields are `cycle` (1 days, 2 weeks, 3 months, 4 years)
and `frequency` (the multiplier). Accept those directly, and also a
`billing_period` string covering `daily`, `weekly`, `biweekly`, `monthly`,
`quarterly`, `semiannually`, `yearly`, and `every N days|weeks|months|years`.

Dates: `start_date` defaults to today. When `next_payment` is absent, derive it
by advancing `start_date` by whole billing periods until it is in the future —
Wallos rejects a next payment in the past. Month arithmetic clamps to the end of
short months (a subscription started on the 31st bills on the 30th in November).
Dates are `YYYY-MM-DD` in the instance's timezone; the Worker runs in UTC and
must not shift a date across a day boundary.

Deletes take `confirm: true`. Wallos deletes a subscription outright, and a
category or payment method that subscriptions still reference.

Logos: accept `logo_url` and pass it through — Wallos fetches it server-side
with its own SSRF guard. Direct file upload is out of scope.

## 5. Constraints

- TypeScript on `agents`' `McpAgent`, `@modelcontextprotocol/sdk`'s `McpServer`,
  hono for the OAuth handler routes, zod v4 for tool arguments.
- `this.server.tool(name, description, shape, handler)`, one tool per call, with
  the description written for an assistant deciding whether to call it.
- Strict TypeScript, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
  included. No `any`, no non-null assertions, tabs, 100 columns, biome clean.
- No secret in a log line, an error message, or a tool result.
- Bound response sizes: a tool result is read into an assistant's context.
- Comments explain why a thing is done, where the reason is not evident. No
  narration of the writing process, no restating the code in prose.

## 6. Verification

```
bun install
bun run check    # biome + tsc --noEmit
bun test
```

Tests run under `bun test` with the Wallos API stubbed at `fetch`: form
encoding, the always-200 error convention, name resolution and creation of
missing entities, billing-period parsing, next-payment derivation across month
ends, the host allowlist, the account cap, and props isolation between grants.
