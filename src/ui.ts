// What the connect page and the landing page share: Wallos's palette, the face
// Wallos sets its interface in, the project's mark, and the drawing of where an
// API key lives. Wallos is GPL-3.0 and none of its code is here — these are its
// token values, read from its stylesheets and written out again.

import type { Strings } from "./i18n";

export const FONT_FACES = `
@font-face { font-family: Barlow; font-style: normal; font-weight: 400; font-display: swap;
  src: url(/_font/barlow-400-latin.woff2) format("woff2"); }
@font-face { font-family: Barlow; font-style: normal; font-weight: 400; font-display: swap;
  src: url(/_font/barlow-400-latin-ext.woff2) format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: Barlow; font-style: normal; font-weight: 600; font-display: swap;
  src: url(/_font/barlow-600-latin.woff2) format("woff2"); }
@font-face { font-family: Barlow; font-style: normal; font-weight: 600; font-display: swap;
  src: url(/_font/barlow-600-latin-ext.woff2) format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF, U+2C60-2C7F, U+A720-A7FF; }
`;

export const TOKENS = `
:root {
  --brand: #2563EB;
  --brand-hover: #1D4ED8;
  --brand-soft: #93C5FD;
  --bg: #F2F4F8;
  --panel: #FFFFFF;
  --border: #E7EAF0;
  --ink: #1C2434;
  --muted: #5A6478;
  --field: #FFFFFF;
  --field-border: #D7DCE5;
  --code-bg: #F6F8FB;
  --shadow: 0 1px 2px rgba(15,23,42,.04), 0 10px 30px -18px rgba(15,23,42,.18);
  --warn-bg: #FFFBEB;
  --warn-border: #FDE68A;
  --warn-ink: #4B3F14;
  --ok: #16A34A;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0F1218;
    --panel: #171B23;
    --border: #262C38;
    --ink: #E4E8F1;
    --muted: #8B94A7;
    --field: #1F2530;
    --field-border: #38404F;
    --code-bg: #12161D;
    --shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 30px -18px rgba(0,0,0,.55);
    --warn-bg: #241E0B;
    --warn-border: #4A3D12;
    --warn-ink: #F5E6B8;
    --ok: #4ADE80;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: Barlow, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
               "Hiragino Sans", "Noto Sans JP", "Noto Sans SC", "Noto Sans KR", sans-serif;
  font-size: 16px; line-height: 1.65; -webkit-font-smoothing: antialiased;
}
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`;

export const MARK = `<svg width="30" height="30" viewBox="0 0 92 92" fill="none" aria-hidden="true">
  <path d="M21.6 10.9 A38 38 0 1 0 73.8 14.1" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".8" fill="none"/>
  <path d="M67 5.4 L80 10.2 L71 18.8 Z" fill="currentColor" opacity=".8"/>
  <rect x="24" y="24" width="44" height="33" rx="7" stroke="currentColor" stroke-width="5" fill="none"/>
  <path d="M28 34 H64" stroke="currentColor" stroke-width="4" opacity=".55"/>
</svg>`;

// The drawing of Wallos's own navigation: menu beside the name, Profile, the
// API Key card. Unlabelled rows stand in for the other entries, so it stays a
// diagram of the path rather than an imitation of the application.
export const DEMO_CSS = `
.demo {
  background: #12151C; border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
  overflow: hidden; box-shadow: 0 18px 40px -22px rgba(0,0,0,.7);
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
  padding: 8px 10px; font-size: .72rem; color: #8B94A7; overflow: hidden; white-space: nowrap;
}
.keyfield span { animation: reveal 9s infinite; }
.keybtn { background: #2563EB; color: #fff; border-radius: 7px; padding: 8px 10px; font-size: .74rem; font-weight: 500; }
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
@keyframes profile { 0%, 50% { opacity: 0; } 56%, 92% { opacity: 1; } 98%, 100% { opacity: 0; } }
@keyframes reveal { 0%, 66% { filter: blur(3px); opacity: .55; } 72%, 100% { filter: blur(0); opacity: 1; } }
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
  .profile, .cursor { display: none; }
}
`;

const MENU_ROWS = 6;
const PROFILE_ROW = 4;

export function demo(t: Strings, esc: (s: string) => string): string {
	const rows = Array.from({ length: MENU_ROWS }, (_, i) =>
		i === PROFILE_ROW
			? `<div class="pick"><i></i>${esc(t.menuProfile)}</div>`
			: `<div><i></i><span class="bar" style="width:${50 + ((i * 17) % 38)}%"></span></div>`,
	).join("");
	return `<div class="demo" role="img" aria-label="${esc(t.guideTitle)}">
  <div class="demo-bar"><div class="avatar"></div><span class="caret">▾</span></div>
  <div class="demo-body">
    <div class="app"><div class="app-row"></div><div class="app-row"></div><div class="app-row"></div></div>
    <div class="menu">${rows}<div class="cursor"></div></div>
    <div class="profile">
      <h4>${esc(t.apiKeyHeading)}</h4>
      <div class="keyrow">
        <div class="keyfield"><span>3f9a2c7e5b1d84a6c0f2e9b7d413a8c5</span></div>
        <div class="keybtn">${esc(t.regenerate)}</div>
      </div>
    </div>
  </div>
</div>`;
}
