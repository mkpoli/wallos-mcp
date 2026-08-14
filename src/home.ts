// The page a deployment serves at its root. It is the first thing a Wallos user
// sees of this server, so it is built from the same tokens and the same drawing
// as the connect page, and it names the address it was reached on rather than a
// placeholder the reader has to substitute.

import { strings } from "./i18n";
import { DEMO_CSS, demo, FONT_FACES, MARK, TOKENS } from "./ui";
import { sanitizeText } from "./workers-oauth-utils";

const CSS = `
${TOKENS}
${DEMO_CSS}
.wrap { max-width: 900px; margin: 0 auto; padding: 0 24px 96px; }
header.hero {
  margin: 0 0 44px; padding: 56px 24px 52px; color: #fff;
  background: linear-gradient(155deg, var(--brand) 0%, #1E40AF 100%);
  position: relative; overflow: hidden;
}
header.hero::after {
  content: ""; position: absolute; width: 760px; height: 760px; border-radius: 50%;
  background: rgba(255,255,255,.07); right: -300px; bottom: -400px;
}
.hero-inner { max-width: 852px; margin: 0 auto; position: relative; z-index: 1; }
.hero + .wrap { padding-top: 0; }
.mark { display: flex; align-items: center; gap: 12px; font-size: 1.3rem; font-weight: 600; letter-spacing: -.01em; }
h1 { font-size: 2.4rem; line-height: 1.2; margin: 22px 0 .3em; letter-spacing: -.03em; max-width: 16em; }
.tagline { margin: 0; font-size: 1.06rem; color: rgba(255,255,255,.86); max-width: 34em; }
.pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
.pill {
  font-size: .78rem; padding: 5px 11px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.28); color: #fff; background: rgba(255,255,255,.1);
}
h2 { font-size: 1.3rem; margin: 48px 0 8px; letter-spacing: -.01em; display: flex; align-items: baseline; gap: .55em; }
h2 .n {
  flex: none; width: 1.65em; height: 1.65em; border-radius: 50%; display: grid; place-items: center;
  font-size: .72em; background: var(--brand); color: #fff; font-weight: 600;
}
h2 + p { color: var(--muted); margin-top: 0; }
.box {
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  padding: 20px 22px; box-shadow: var(--shadow); margin: 18px 0;
}
pre {
  background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px 16px; overflow-x: auto; margin: 14px 0; font-size: 13.5px; line-height: 1.6;
}
p code, li code, td code { background: var(--code-bg); padding: .12em .38em; border-radius: 5px; font-size: .92em; }
a { color: var(--brand); text-underline-offset: 2px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: .95rem; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: .76rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; }
.note {
  border-left: 3px solid var(--brand); background: color-mix(in oklab, var(--brand) 7%, transparent);
  padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0; font-size: .95rem;
}
.note.warn { border-left-color: var(--warn-border); background: var(--warn-bg); color: var(--warn-ink); }
.flow { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 10px; align-items: center; margin: 26px 0 0; }
.flow .box2 {
  border: 1px solid rgba(255,255,255,.28); border-radius: 12px; padding: 13px 10px; text-align: center;
  background: rgba(255,255,255,.1); font-size: .85rem; line-height: 1.4; color: rgba(255,255,255,.9);
}
.flow .box2 b { display: block; font-size: .95rem; margin-bottom: 2px; color: #fff; }
.flow .arrow { color: rgba(255,255,255,.7); font-size: 1.25rem; text-align: center; }
.twocol { display: grid; grid-template-columns: 1fr 380px; gap: 26px; align-items: start; }
.checkline { display: flex; gap: .6em; align-items: flex-start; margin: .45em 0; }
.checkline span:first-child { color: var(--ok); font-weight: 700; }
footer {
  margin-top: 72px; padding-top: 24px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: .9rem; text-align: center;
}
footer a { color: var(--muted); }
@media (max-width: 820px) {
  .flow { grid-template-columns: 1fr; }
  .flow .arrow { transform: rotate(90deg); }
  .twocol { grid-template-columns: 1fr; }
  h1 { font-size: 1.9rem; }
}
`;

export function homePage(origin: string): Response {
	const t = strings("en");
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wallos-mcp</title>
<meta name="description" content="A self-hosted Wallos subscription tracker, served to any MCP client from a Cloudflare Worker.">
<style>${FONT_FACES}${CSS}</style>
</head>
<body>
<header class="hero">
  <div class="hero-inner">
    <div class="mark">${MARK} wallos-mcp</div>
    <h1>Your subscriptions, in the hands of your assistant.</h1>
    <p class="tagline">A self-hosted <a href="https://github.com/ellite/Wallos" style="color:#fff">Wallos</a> instance, served to Claude and any other MCP client. List, create, edit and delete subscriptions; manage categories, payment methods, household members and currencies.</p>
    <div class="pills">
      <span class="pill">OAuth 2.1 + PKCE</span>
      <span class="pill">Wallos 5.0+</span>
      <span class="pill">28 languages</span>
      <span class="pill">33 tools</span>
      <span class="pill">MIT</span>
    </div>
    <div class="flow">
      <div class="box2"><b>MCP client</b>Claude Code · claude.ai · mobile</div>
      <div class="arrow">→</div>
      <div class="box2"><b>this Worker</b>OAuth server + agent</div>
      <div class="arrow">→</div>
      <div class="box2"><b>your Wallos</b>one account per connection</div>
    </div>
  </div>
</header>

<div class="wrap">

<h2><span class="n">1</span> Connect a client to this deployment</h2>
<p>Running Wallos 5.0 or newer, reachable over HTTPS? Point a client at this address and sign in.</p>

<pre>claude mcp add --transport http wallos ${sanitizeText(origin)}/mcp</pre>

<p>In claude.ai it is <b>Settings → Connectors → Add custom connector</b> with <code>${sanitizeText(origin)}/mcp</code>. Leave any client ID and secret fields empty — MCP clients register themselves. Any single-segment label after <code>/mcp/</code>, such as <code>/mcp/household</code>, is a separate connection with its own grant.</p>

<div class="note warn">
  Your API key is stored, encrypted, by whoever operates this deployment, and it carries the same authority over your subscriptions as your Wallos password. Regenerating it in Wallos ends that access immediately. To keep the key on your own account instead, deploy your own copy — it is the same software, and section 3 is the whole procedure.
</div>

<h2><span class="n">2</span> Where your API key is</h2>
<div class="twocol">
  <div>
    <p>The sign-in page asks for two things: the address you open Wallos at, and an API key. The key lives on your own profile page, at <code>/profile.php</code> on your instance — open the menu beside your name, go to Profile, and copy the key under <b>API Key</b>. If the field is empty, Regenerate fills it.</p>
    <p>The key is the whole credential: everything this server can read or change, it changes as you. Wallos lets you regenerate it whenever you like, which invalidates the old one and every connection holding it.</p>
  </div>
  ${demo(t, sanitizeText)}
</div>

<h2><span class="n">3</span> Run your own</h2>
<p>You need a Cloudflare account and <a href="https://bun.sh">bun</a>. Without a custom domain the Worker answers on <code>workers.dev</code>.</p>

<pre>git clone https://github.com/mkpoli/wallos-mcp &amp;&amp; cd wallos-mcp
bun install
bun run setup</pre>

<p><code>bun run setup</code> asks which domain to answer on, creates the KV namespace, takes <code>ALLOWED_HOSTS</code>, generates a cookie key, and deploys. Re-running it to rotate one secret is safe.</p>

<h2><span class="n">4</span> Which instances a deployment will reach</h2>
<p><code>ALLOWED_HOSTS</code> is the list of Wallos hosts a connection may name. The MCP endpoint is public and clients register themselves, so this is what stops a stranger pointing a deployment at somebody else's instance.</p>

<table>
  <tr><th>Value</th><th>Meaning</th></tr>
  <tr><td><code>wallos.example.com</code></td><td>that one instance</td></tr>
  <tr><td><code>wallos.example.com, money.example.org</code></td><td>either of them</td></tr>
  <tr><td><code>*.example.com</code></td><td>any host in the domain</td></tr>
  <tr><td><code>*</code></td><td>any host at all, which is what a shared deployment sets</td></tr>
  <tr><td>empty</td><td>nobody signs in</td></tr>
</table>

<p>Whatever a sign-in names, the Worker fetches, so the URL must be <code>https</code> and must not point anywhere private: RFC1918, CGNAT, link-local, IPv6 unique-local and <code>.local</code> / <code>.internal</code> names are refused, and <code>global_fetch_strictly_public</code> enforces the same at the platform. Redirects are refused rather than followed, since a 307 would replay the request — key included — at a host the allowlist never saw.</p>

<h2><span class="n">5</span> What you get</h2>
<div class="box">
  <div class="checkline"><span>✓</span><span><b>Subscriptions</b> — list with filters, read one, create, edit, delete, monthly cost, iCal feed</span></div>
  <div class="checkline"><span>✓</span><span><b>Master data</b> — categories, payment methods, household members and currencies, each readable and writable</span></div>
  <div class="checkline"><span>✓</span><span><b>Names instead of ids</b> — "Netflix, ¥1490 monthly, Entertainment, paid by card" creates the category and the payment method if your instance lacks them</span></div>
  <div class="checkline"><span>✓</span><span><b>Settings</b> — display preferences, notification settings, exchange-rate provider</span></div>
  <div class="checkline"><span>✓</span><span><b>Budgets</b> — period budget and spend, on Wallos 5.3 and newer</span></div>
</div>

<div class="note">
  Administration tools — OIDC, registration, SMTP, disabling password login — are registered only when a deployment sets <code>ADMIN_TOOLS</code> to <code>1</code> <em>and</em> the bound key passes an admin read. They rewrite how everyone signs in to the instance.
</div>

<footer>
  <a href="https://github.com/mkpoli/wallos-mcp">github.com/mkpoli/wallos-mcp</a> · MIT ·
  built for <a href="https://github.com/ellite/Wallos">Wallos</a>
</footer>

</div>
</body>
</html>`;

	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=300",
		},
	});
}
