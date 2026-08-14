// The connect page. A Wallos user arrives here straight from their own
// instance, so it borrows Wallos's proportions and palette — split panel, its
// blue, Barlow — while the walkthrough on the left is a drawing of Wallos's own
// navigation rather than a screenshot of it: the point is to show where the key
// lives without the reader having to translate prose into clicks.

import { isRtl, LOCALES, strings } from "./i18n";
import { DEMO_CSS, demo, FONT_FACES, MARK, TOKENS } from "./ui";
import { sanitizeText } from "./workers-oauth-utils";

// Wallos's own tokens, read from its stylesheets and rewritten here. Wallos is
// GPL-3.0; nothing is copied from it, and matching a palette is not copying.
const CSS = `
${TOKENS}
${DEMO_CSS}
html, body { height: 100%; }
.split { display: grid; grid-template-columns: 1.05fr 1fr; min-height: 100%; }
.brand {
  position: relative; overflow: hidden; padding: 44px 48px;
  background: linear-gradient(155deg, var(--brand) 0%, #1E40AF 100%); color: #fff;
  display: flex; flex-direction: column; gap: 28px;
}
.brand::after {
  content: ""; position: absolute; width: 720px; height: 720px; border-radius: 50%;
  background: rgba(255,255,255,.07); right: -280px; bottom: -320px;
}
.brand > * { position: relative; z-index: 1; }
.mark { display: flex; align-items: center; gap: 12px; font-size: 1.35rem; font-weight: 600; letter-spacing: -.01em; }
.mark svg { flex: none; }
.guide-title { font-size: 1.5rem; font-weight: 600; margin: 0; letter-spacing: -.02em; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.steps li { display: flex; gap: 10px; align-items: baseline; font-size: .95rem; color: rgba(255,255,255,.86); }
.steps .n {
  flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,.16);
  display: inline-grid; place-items: center; font-size: .74rem; font-weight: 600; color: #fff;
}
.steps li.on { color: #fff; }
.steps li.s1 { animation: step1 9s infinite; }
.steps li.s2 { animation: step2 9s infinite; }
.steps li.s3 { animation: step3 9s infinite; }
.steps li.s1 .n { animation: dot1 9s infinite; }
.steps li.s2 .n { animation: dot2 9s infinite; }
.steps li.s3 .n { animation: dot3 9s infinite; }
@keyframes step1 { 0%, 26% { color: #fff; } 30%, 100% { color: rgba(255,255,255,.6); } }
@keyframes step2 { 0%, 26% { color: rgba(255,255,255,.6); } 30%, 52% { color: #fff; } 56%, 100% { color: rgba(255,255,255,.6); } }
@keyframes step3 { 0%, 52% { color: rgba(255,255,255,.6); } 56%, 94% { color: #fff; } 98%, 100% { color: rgba(255,255,255,.6); } }
@keyframes dot1 { 0%, 26% { background: #fff; color: var(--brand); } 30%, 100% { background: rgba(255,255,255,.16); color: #fff; } }
@keyframes dot2 { 0%, 26% { background: rgba(255,255,255,.16); color: #fff; } 30%, 52% { background: #fff; color: var(--brand); } 56%, 100% { background: rgba(255,255,255,.16); color: #fff; } }
@keyframes dot3 { 0%, 52% { background: rgba(255,255,255,.16); color: #fff; } 56%, 94% { background: #fff; color: var(--brand); } 98%, 100% { background: rgba(255,255,255,.16); color: #fff; } }

/* The illustration: a Wallos-shaped window, drawn, not captured. */
.demo {
  background: #12151C; border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
  overflow: hidden; box-shadow: 0 18px 40px -22px rgba(0,0,0,.7); max-width: 420px;
}
.demo-bar {
  height: 42px; background: #171B23; border-bottom: 1px solid rgba(255,255,255,.08);
  display: flex; align-items: center; justify-content: flex-end; padding: 0 12px; gap: 8px;
}
.avatar { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(140deg,#60A5FA,#2563EB); }
.caret { color: rgba(255,255,255,.6); font-size: .7rem; }
.demo-body { position: relative; height: 208px; }
.app { position: absolute; inset: 12px 12px auto 12px; display: grid; gap: 8px; }
.app-row { height: 30px; border-radius: 7px; background: rgba(255,255,255,.05); }
.menu {
  position: absolute; right: 10px; top: 8px; width: 176px; z-index: 2; background: #1B2029;
  border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 6px;
  opacity: 0; transform: translateY(-6px); animation: menu 9s infinite;
}
.menu div {
  display: flex; align-items: center; gap: 9px; padding: 5px 8px; border-radius: 6px;
  font-size: .78rem; color: rgba(255,255,255,.72);
}
.menu .bar { display: block; height: .5em; background: currentColor; opacity: .22; border-radius: 3px; }
.menu div.pick { animation: pick 9s infinite; }
.menu i { width: 13px; height: 13px; border: 1.5px solid currentColor; border-radius: 3px; opacity: .75; flex: none; }
.menu div.pick i { border-radius: 50%; }
.profile {
  position: absolute; inset: 14px; z-index: 3; background: #171B23; border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px; padding: 14px; opacity: 0; animation: profile 9s infinite;
}
.profile h4 { margin: 0 0 10px; font-size: .9rem; font-weight: 600; color: #E4E8F1; }
.keyrow { display: flex; gap: 8px; }
.keyfield {
  flex: 1; background: #1F2530; border: 1px solid #38404F; border-radius: 7px;
  padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .72rem; color: #8B94A7; overflow: hidden; white-space: nowrap;
}
.keyfield span { animation: reveal 9s infinite; }
.keybtn { background: var(--brand); color: #fff; border-radius: 7px; padding: 8px 10px; font-size: .74rem; font-weight: 500; }
.cursor {
  position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: rgba(255,255,255,.9); box-shadow: 0 0 0 4px rgba(255,255,255,.25);
  right: 24px; top: -22px; animation: cursor 9s infinite;
}
@keyframes menu {
  0%, 8% { opacity: 0; transform: translateY(-6px); }
  12%, 46% { opacity: 1; transform: translateY(0); }
  52%, 100% { opacity: 0; transform: translateY(-6px); }
}
@keyframes pick {
  0%, 28% { background: transparent; color: rgba(255,255,255,.72); }
  34%, 48% { background: rgba(37,99,235,.28); color: #fff; }
  54%, 100% { background: transparent; color: rgba(255,255,255,.72); }
}
@keyframes profile {
  0%, 50% { opacity: 0; }
  56%, 92% { opacity: 1; }
  98%, 100% { opacity: 0; }
}
@keyframes reveal {
  0%, 66% { filter: blur(3px); opacity: .55; }
  72%, 100% { filter: blur(0); opacity: 1; }
}
@keyframes cursor {
  0%, 6% { top: -22px; right: 24px; opacity: 0; }
  10% { opacity: 1; }
  14%, 26% { top: -14px; right: 24px; }
  34%, 46% { top: 96px; right: 120px; }
  50% { opacity: 1; }
  56%, 100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .menu, .profile, .cursor, .menu div.pick, .keyfield span { animation: none; }
  .menu { opacity: 1; transform: none; }
  .profile { display: none; }
  .cursor { display: none; }
}

.formside { display: flex; align-items: center; justify-content: center; padding: 40px 32px; background: var(--bg); }
.card { width: 100%; max-width: 420px; }
h1 { font-size: 1.75rem; font-weight: 600; margin: 0 0 .25em; letter-spacing: -.02em; }
.lede { color: var(--muted); margin: 0 0 22px; font-size: .96rem; }
label { display: block; font-weight: 500; margin: 16px 0 6px; font-size: .95rem; }
input[type=url], input[type=password] {
  width: 100%; padding: .7rem .8rem; border: 1px solid var(--field-border); border-radius: 8px;
  background: var(--field); color: var(--ink); font: inherit; font-size: .95rem;
}
input:focus { outline: 2px solid var(--brand-soft); outline-offset: 1px; border-color: var(--brand); }
.fieldhint { color: var(--muted); font-size: .84rem; margin: 5px 0 0; }
.fieldhint a { color: var(--brand); }
button.submit {
  width: 100%; margin-top: 22px; padding: .8rem 1rem; border: none; border-radius: 8px;
  background: var(--brand); color: #fff; font: inherit; font-size: 1rem; font-weight: 500; cursor: pointer;
}
button.submit:hover { background: var(--brand-hover); }
.custody {
  background: var(--warn-bg); border: 1px solid var(--warn-border); color: var(--warn-ink);
  border-radius: 8px; padding: .75rem .9rem; font-size: .85rem; margin: 0 0 20px;
}
.error {
  background: #FEF2F2; border: 1px solid #FCA5A5; color: #991B1B;
  border-radius: 8px; padding: .7rem .9rem; margin: 0 0 16px; font-size: .9rem;
}
@media (prefers-color-scheme: dark) {
  .error { background: #2A1416; border-color: #7F2427; color: #FCA5A5; }
}
.foot { margin-top: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.foot a { color: var(--muted); font-size: .85rem; }
select {
  background: var(--field); color: var(--ink); border: 1px solid var(--field-border);
  border-radius: 7px; padding: .35rem .5rem; font: inherit; font-size: .85rem;
}
@media (max-width: 900px) {
  .split { grid-template-columns: 1fr; }
  .brand { padding: 28px 24px; }
  .demo { max-width: none; }
}
`;

export function signInPage(opts: {
	csrfToken: string;
	stateToken: string;
	locale: string;
	error?: string;
	baseUrl?: string;
	status?: number;
	setCookie?: string;
	extraCookies?: string[];
}): Response {
	const t = strings(opts.locale);
	const rtl = isRtl(opts.locale);
	// A right-to-left page reads "onward" as leftward.
	const onward = rtl ? "←" : "→";
	const error = opts.error ? `<p class="error">${sanitizeText(opts.error)}</p>` : "";
	const baseUrl = sanitizeText(opts.baseUrl ?? "");
	const options = LOCALES.map(
		(l) =>
			`<option value="${l.code}"${l.code === opts.locale ? " selected" : ""}>${sanitizeText(l.label)}</option>`,
	).join("");

	const html = `<!DOCTYPE html>
<html lang="${sanitizeText(opts.locale.replace("_", "-"))}"${rtl ? ' dir="rtl"' : ""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${sanitizeText(t.title)}</title>
<style>${FONT_FACES}${CSS}</style>
</head>
<body>
<div class="split">
  <aside class="brand">
    <div class="mark">
      ${MARK}
      wallos-mcp
    </div>
    <div>
      <h2 class="guide-title">${sanitizeText(t.guideTitle)}</h2>
      <ol class="steps">
        <li class="s1"><span class="n">1</span>${sanitizeText(t.step1)}</li>
        <li class="s2"><span class="n">2</span>${sanitizeText(t.step2)}</li>
        <li class="s3"><span class="n">3</span>${sanitizeText(t.step3)}</li>
      </ol>
    </div>
    ${demo(t, sanitizeText)}
  </aside>

  <main class="formside">
    <div class="card">
      <h1>${sanitizeText(t.heading)}</h1>
      <p class="lede">${sanitizeText(t.lede)}</p>
      <p class="custody">${sanitizeText(t.custody)}</p>
      ${error}
      <form method="post" action="/sign-in">
        <input type="hidden" name="csrf_token" value="${sanitizeText(opts.csrfToken)}">
        <input type="hidden" name="oauth_state" value="${sanitizeText(opts.stateToken)}">
        <input type="hidden" name="lang" value="${sanitizeText(opts.locale)}">
        <label for="base_url">${sanitizeText(t.urlLabel)}</label>
        <input id="base_url" name="base_url" type="url" required inputmode="url" autocomplete="url"
               placeholder="https://wallos.example.com" value="${baseUrl}">
        <p class="fieldhint">${sanitizeText(t.urlHint)}</p>
        <label for="api_key">${sanitizeText(t.keyLabel)}</label>
        <input id="api_key" name="api_key" type="password" required autocomplete="off" spellcheck="false">
        <p class="fieldhint">${sanitizeText(t.keyHint)} <a id="profile_link" href="#" hidden target="_blank" rel="noreferrer noopener">${sanitizeText(t.openProfile)} ${onward}</a></p>
        <button type="submit" class="submit">${sanitizeText(t.submit)}</button>
      </form>
      <div class="foot">
        <a href="https://github.com/mkpoli/wallos-mcp">${sanitizeText(t.selfHost)} ${onward}</a>
        <form method="get" action="/sign-in">
          <input type="hidden" name="state" value="${sanitizeText(opts.stateToken)}">
          <label for="lang" style="display:inline;margin:0 .4em 0 0;font-size:.85rem;color:var(--muted)">${sanitizeText(t.language)}</label>
          <select id="lang" name="lang" onchange="this.form.submit()">${options}</select>
        </form>
      </div>
    </div>
  </main>
</div>
<script>
// The profile page is one link away once the instance is known, and typing the
// address is the only thing this server can learn it from.
(function () {
  var url = document.getElementById("base_url");
  var link = document.getElementById("profile_link");
  function sync() {
    try {
      var u = new URL(url.value);
      if (u.protocol !== "https:") throw 0;
      link.href = u.origin + u.pathname.replace(/\\/+$/, "") + "/profile.php";
      link.hidden = false;
    } catch (e) { link.hidden = true; }
  }
  url.addEventListener("input", sync);
  sync();
})();
</script>
</body>
</html>`;

	const headers = new Headers({
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Security-Policy": "frame-ancestors 'none'",
		"X-Frame-Options": "DENY",
	});
	if (opts.setCookie) headers.append("Set-Cookie", opts.setCookie);
	for (const cookie of opts.extraCookies ?? []) headers.append("Set-Cookie", cookie);
	return new Response(html, { status: opts.status ?? 200, headers });
}
