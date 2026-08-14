<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./docs/logo-light.svg">
  <img src="./docs/logo-light.svg" alt="wallos-mcp" width="520">
</picture>

**Your subscription tracker, readable and writable by your AI assistant, on a server you own.**

[![MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![MCP](https://img.shields.io/badge/protocol-MCP-6E56CF)](https://modelcontextprotocol.io/)
[![OAuth 2.1](https://img.shields.io/badge/auth-OAuth_2.1_+_PKCE-2ea44f)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
[![33 tools](https://img.shields.io/badge/tools-33-0b7285)](#what-it-can-do)
[![tests](https://img.shields.io/badge/tests-105_passing-success?logo=bun&logoColor=white)](#how-it-was-tested)
[![28 languages](https://img.shields.io/badge/languages-28-2563EB)](#the-connect-page)
[![Wallos 5.0+](https://img.shields.io/badge/Wallos-5.0%2B-0d9488)](#which-wallos-it-works-with)

</div>

**wallos-mcp** connects a self-hosted [Wallos](https://github.com/ellite/Wallos) instance to Claude and any other [MCP](https://modelcontextprotocol.io/) client. It can **list, create, edit and delete subscriptions**, manage **categories, payment methods, household members and currencies**, and read **monthly cost, budgets, settings and the iCal feed**.

It runs as a remote server on **your own Cloudflare Worker**, so the same connection answers from Claude Code on a laptop, claude.ai in a browser, and Claude on a phone. Each connection signs in to **one** Wallos account by naming an instance and pasting its API key, and that key stays in **your** Cloudflare account.

### Which Wallos it works with

**Wallos v5.0.0 or newer** — that release, on 2026-07-11, introduced the API-key HTTP API with `action=add|edit|delete` write endpoints for subscriptions and every master-data list. This server is built on that API alone: no password, no session cookie, no scraped form post. Of the 27 endpoints it calls, 25 exist from v5.0.0; `get_period_budget` and `update_budget` arrived in **v5.3.0** and are simply absent from the tool list on anything older.

A sign-in naming an instance below 5.0.0 is refused with its version, rather than binding a connection whose every call would fail. Verified end to end against **v5.2.0** and **v5.4.2**.

---

## How it compares

| | **wallos-mcp** | [ilyannn/<br>wallos-mcp](https://github.com/ilyannn/wallos-mcp) | [XimilalaXiang/<br>wallos-mcp-go](https://github.com/XimilalaXiang/wallos-mcp-go) |
| :-- | :-: | :-: | :-: |
| Where it runs | Cloudflare Workers | local process | Docker container |
| Reachable from a phone | ✅ | ❌ | ✅ if you expose it |
| How it authenticates to Wallos | API key | **username + password**, then a session cookie | API key |
| Works against Wallos v5 | ✅ | ❌ writes target `endpoints/subscription/edit.php`, deleted upstream in v5.0 | ❌ writes target `api/*/create_subscription.php`, `add_category.php` — filenames that have never existed in Wallos |
| Tools | 26, plus 5 admin and 2 more on Wallos 5.3+ | 7 | 7 |
| Delete a subscription | ✅ | ❌ | ❌ |
| Several instances at once | ✅ one per connection | ❌ | ❌ |
| Last commit | — | August 2025 | April 2026 |

Both existing servers predate the v5 API. The endpoint claims above are checkable: `git log` upstream shows `endpoints/subscription/edit.php` removed in the v5.0 UI overhaul, and `api/subscriptions/create_subscription.php` answers 404 on any v5 instance.

---

## Use it

### Connect to the hosted deployment

```sh
claude mcp add --transport http wallos https://wallos-mcp.mkpo.li/mcp
```

Sign in with your instance URL and API key. The key is held encrypted in that deployment's KV, which means trusting whoever runs it with the same authority your Wallos password carries; regenerating the key in Wallos ends that access at once. Anyone who would rather not make that trade deploys their own below — it is the same software and takes about five minutes.

### Or deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mkpoli/wallos-mcp)

The button copies the repository into your GitHub account, creates the KV namespace and the Durable Object, and asks for the two secrets.

From a terminal instead — you need a Cloudflare account, [bun](https://bun.sh), and a Wallos instance reachable over HTTPS:

```sh
git clone https://github.com/mkpoli/wallos-mcp && cd wallos-mcp
bun install
bun run setup
```

`bun run setup` asks which domain to answer on, creates or reuses the KV namespace, takes `ALLOWED_HOSTS`, generates a cookie key, and deploys. The first two answers land in `wrangler.local.jsonc`, which git ignores, so `wrangler.jsonc` names nobody's namespace and nobody's domain and a clone deploys anywhere. Re-running it to rotate one secret is safe.

<details>
<summary>The individual commands, if you would rather not run a script</summary>

### 1 · Copy your Wallos API key

In Wallos, open **Settings** and find **API key** on your own profile. Generate one if the field is empty.

### 2 · Deploy the Worker

```sh
git clone https://github.com/mkpoli/wallos-mcp && cd wallos-mcp
bun install
bunx wrangler kv namespace create wallos-mcp-oauth
bunx wrangler secret put COOKIE_ENCRYPTION_KEY   # openssl rand -hex 32
bunx wrangler secret put ALLOWED_HOSTS           # e.g. wallos.example.com
bun run deploy
```

Put the KV namespace id wrangler prints into `wrangler.jsonc`. Without a custom domain the Worker answers on `workers.dev`.

### 3 · Connect a client

Leave any client ID and secret fields empty — MCP clients register themselves.

```sh
claude mcp add --transport http wallos https://<your-host>/mcp
```

Run `/mcp` in Claude Code to sign in: the page asks for the Wallos URL and the API key. In claude.ai it is **Settings → Connectors → Add custom connector** with the same URL. Any single-segment label after `/mcp/` — `/mcp/household` — is a separate connection with its own grant, which is how one deployment serves two trackers to clients that reject two servers sharing a URL.

Your deployment serves a setup guide at `https://<your-host>/`.

</details>

---

## What it can do

<table>
<tr><th align="left">📋 Subscriptions</th><th align="left">🗂 Master data</th><th align="left">⚙️ Settings</th></tr>
<tr valign="top">
<td>

`list_subscriptions`<br>
`get_subscription`<br>
`create_subscription`<br>
`update_subscription`<br>
`delete_subscription`<br>
`get_monthly_cost`<br>
`get_ical_feed`<br>
`get_period_budget` ᵛ<br>
`update_budget` ᵛ

</td>
<td>

`get_master_data`<br>
`create_category`<br>
`update_category`<br>
`delete_category`<br>
`create_payment_method`<br>
`update_payment_method`<br>
`delete_payment_method`<br>
`create_household_member`<br>
`update_household_member`<br>
`delete_household_member`<br>
`create_currency`<br>
`update_currency`<br>
`delete_currency`

</td>
<td>

`whoami`<br>
`get_settings`<br>
`update_settings`<br>
`get_notification_settings`<br>
`get_fixer_settings`<br>
`update_fixer_settings`<br>
<br>
**Admin** ᵃ<br>
`get_admin_settings`<br>
`update_admin_settings`<br>
`get_oidc_settings`<br>
`update_oidc_settings`<br>
`set_password_login_disabled`

</td>
</tr>
</table>

ᵛ registered when the instance reports Wallos 5.3 or newer · ᵃ registered when `ADMIN_TOOLS` is `1` **and** the bound key passes an admin read

### The connect page

Signing in is the one moment a Wallos user leaves their own instance, so the page they land on borrows Wallos's proportions, palette and typeface: the split brand panel, `#2563EB`, Barlow. The font is served by the Worker itself, because a page where somebody is typing an API key should not also be calling a font CDN.

The left panel animates where the key actually is — the menu beside your name, Profile, the API Key field — as a drawing of that navigation rather than a screenshot of it, with captions that light up in step. `prefers-reduced-motion` stops the motion and leaves the menu open. Once you type your instance URL, a link to that instance's own `profile.php` appears beside the key field.

It speaks the **28 languages Wallos itself ships**, under Wallos's own locale codes, chosen from `Accept-Language` and overridable from the picker. Arabic renders right-to-left, arrows included. The strings are this project's own — Wallos is GPL-3.0 and nothing of its is copied here (see [THIRD-PARTY.md](./THIRD-PARTY.md)) — and they are unreviewed by native speakers, so corrections are welcome as PRs.

### Names instead of ids

The Wallos API takes integer ids. An assistant has names, so `create_subscription` and `update_subscription` accept both:

```
"Netflix, ¥1490 monthly, category Entertainment, paid by Visa, from today"
```

`category_name`, `payment_method_name`, `payer_name` and `currency_code` are matched case-insensitively against the instance's own lists, and created when missing — `create_missing: false` turns that into an error listing what does exist. An explicit `*_id` always wins.

`billing_period` accepts `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`, `semiannually`, `yearly`, or `every N days|weeks|months|years`, alongside the raw `cycle` and `frequency` the API wants. When `next_payment` is omitted it is derived by advancing the start date whole periods until it is no longer in the past, because Wallos rejects a past next payment. Month arithmetic counts from the original start day, so a subscription started on the 31st bills on the 30th in November and on the 31st again in December.

---

## How it works

```
MCP client  ──OAuth 2.1──▶  your Worker  ──api_key──▶  your Wallos
```

The Worker is an OAuth 2.1 authorization server to its MCP clients, and Wallos issues API keys rather than tokens, so the sign-in step is a form: the Wallos URL and the key. The pair is checked against `api/users/get_user.php` before any grant exists. What the grant stores — base URL, key, user id, username, instance version — is encrypted at rest in your `OAUTH_KV` namespace and handed to the session as `props`. The MCP client never sees the key.

Each session is a Durable Object holding one grant. The bound account travels from the OAuth boundary on a header the Worker sets after stripping any inbound copy, and the object refuses to start on a grant that does not own it.

Three properties of the Wallos API shape the client, all of them documented in [`docs/wallos-api.md`](./docs/wallos-api.md):

- **Every response is HTTP 200**, authentication failures included. `success` in the body is the only signal.
- **Writes read `$_POST` only.** A JSON body arrives empty and the endpoint answers "Missing API key", so every request is form-encoded.
- **Some flags are compared with `=== 'true'`.** `convert_currency=1` is silently ignored and returns unconverted prices while reporting success; the list filter Wallos reads is `payment`, not `payment_method`.

### Built with

[`agents`](https://github.com/cloudflare/agents) · [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) · [hono](https://hono.dev) · [zod](https://zod.dev)

---

## Who can sign in

`ALLOWED_HOSTS` decides which Wallos hosts a connection may name: a comma-separated list, `*.example.com`, or `*` for any host. Empty admits nobody. `MAX_ACCOUNTS` caps how many distinct installations-plus-users may ever complete sign-in.

Whatever a sign-in names, the Worker fetches, so the URL must be `https` and must not point anywhere private. RFC1918, CGNAT, link-local (cloud metadata at `169.254.169.254` included), IPv6 unique-local and `.local` / `.internal` names are refused at sign-in with an explanation, and the `global_fetch_strictly_public` compatibility flag enforces the same thing at the platform, where a public name resolving to a private address is caught too. An instance on a home network belongs behind a tunnel with a public hostname.

Redirects are refused rather than followed. A `307` or `308` preserves the method and the body, so an instance that answers one would have the request — API key included — replayed at whatever host the `Location` names, which the allowlist never saw.

## Limits

- One Wallos account per connection. Two accounts means two connections.
- Logos are attached by URL; Wallos fetches them itself. File upload is out of scope.
- Notification settings are readable and not writable, because Wallos ships no setter for them.
- `get_period_budget` and `update_budget` need Wallos 5.3 or newer; on an older instance they are absent rather than failing.

## Security

- The API key lives only in the encrypted grant. It is stripped from error messages, and secret-looking fields — keys, passwords, tokens, webhook credentials — are masked in tool results.
- Requests to Wallos are form-encoded POSTs, which keeps the key out of URLs, access logs and proxy history.
- Response bodies and tool results are bounded, and each account has its own rate-limit counter.
- The administration tools rewrite how everyone signs in to the instance. They stay unregistered unless the operator opts in and the bound key is actually an admin key.

## How it was tested

`bun test` runs 105 tests with `fetch` stubbed: form encoding, the always-200 error convention, billing-period parsing, next-payment derivation across month ends and leap years, name resolution and creation, the host allowlist, the private-address refusal, the minimum-version floor, locale negotiation and translation completeness, the account cap, and grant isolation between sessions.

`scripts/e2e.ts` runs the client against a real instance, which is where the wire contract is actually settled:

```sh
WALLOS_URL=https://wallos.example.com WALLOS_API_KEY=... bun run scripts/e2e.ts
WALLOS_URL=... WALLOS_API_KEY=... bun run scripts/e2e.ts --write
```

The read pass checks versions, users, master data, filters, costs and settings, and that a wrong key is refused. The `--write` pass creates a category and a subscription, edits the subscription and reads the change back, then deletes both and confirms they are gone. It has been run against Wallos v5.2.0 and v5.4.2.

The deployment itself was verified by driving a client handshake end to end against it — dynamic registration, `/authorize`, the approval dialog, sign-in with a real key, the code-for-token exchange, `initialize`, `tools/list`, and two `tools/call` round trips returning live data.

## Development

```sh
bun install
bun run check   # biome + tsc
bun test
bun run dev     # wrangler dev
```

## License

MIT
