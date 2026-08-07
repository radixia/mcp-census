/**
 * The census stylesheet, served from the Worker at `/census/assets/census.css`.
 *
 * An external sheet rather than inline style, because the Worker's CSP is
 * `style-src 'self'` with no `unsafe-inline` — see apps/worker/src/security.ts.
 *
 * Two layers, and the split is the point:
 *
 *   STRUCTURE_CSS  layout and components. Theme-independent: every colour, font,
 *                  radius and width is `var(--token)`. Shared by all themes.
 *   the theme      token values only, from packages/core/src/theme. Swappable.
 *
 * Nothing below names a brand. `--accent` rather than `--magenta`, so a fork can
 * re-theme by supplying values instead of editing rules. The one literal colour is
 * `#fff` on a button, which is paired with `--accent-btn` — a token chosen for
 * contrast against white text specifically.
 */

import { type CensusTheme, renderThemeCss } from "@mcp-census/core";

const STRUCTURE_CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-body);
  font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:var(--w-max);margin:0 auto;padding:0 20px}
a{color:var(--accent-deep);text-decoration:none}
a:hover{color:var(--accent);text-decoration:underline}
h1,h2,h3{font-family:var(--font-display);font-weight:600;line-height:1.15;margin:0 0 .5em}
h1{font-size:clamp(2rem,5vw,3.1rem)}
h2{font-size:clamp(1.4rem,3vw,2rem);margin-top:2.2em}
h3{font-size:1.15rem;margin-top:1.6em}
p{margin:0 0 1em}
code,.mono{font-family:var(--font-mono);font-size:.9em}

/* Visible keyboard focus everywhere. Without this the pill links and the check
   form are keyboard-navigable but give no indication of where you are. */
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

header.top{border-bottom:1px solid var(--line);background:var(--paper-2)}
header.top .wrap{display:flex;gap:20px;align-items:baseline;padding:14px 20px;flex-wrap:wrap}
header.top .brand{font-family:var(--font-display);font-weight:600;color:var(--ink)}
/* Back up to the parent site, on every page including 404s.
   Was --ink-3 at .88rem on the theory that an exit should be quiet. That read as
   absent — the first feedback on it was that it wasn't there — so it is now the
   same weight as the nav with a visible separator after it. Quiet is fine for a
   footer link; a way out of a subsite has to be findable. */
header.top .up{color:var(--ink-2);font-weight:600;white-space:nowrap;
  padding-right:20px;border-right:1px solid var(--line)}
header.top .up:hover{color:var(--accent-deep)}
/* On narrow screens the flex row wraps; keep the way out on its own first line
   rather than letting it collide with the product name. */
@media (max-width:560px){
  header.top .wrap{gap:10px}
  header.top .up{flex:1 0 100%;border-right:0;padding-right:0}
}
header.top nav{display:flex;gap:16px;flex-wrap:wrap;font-size:.92rem}
header.top nav a{color:var(--ink-2)}

.eyebrow{font-size:.78rem;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-3);margin:0 0 .6em}
main{padding:44px 0 72px}
.lede{font-size:1.16rem;color:var(--ink-2);max-width:64ch}

/* the headline number */
.headline{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:32px;margin:28px 0}
.headline .big{font-family:var(--font-display);font-size:clamp(3rem,11vw,6.5rem);
  line-height:1;color:var(--accent);font-weight:600;display:block}
.headline .said{font-size:1.1rem;color:var(--ink-2);max-width:56ch;margin-top:.4em}

.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin:22px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.stat .n{font-family:var(--font-display);font-size:1.9rem;line-height:1;display:block}
.stat .k{font-size:.82rem;color:var(--ink-3);margin-top:.35em;display:block}

table{width:100%;border-collapse:collapse;font-size:.94rem;margin:18px 0}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}

.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.76rem;
  border:1px solid var(--line);color:var(--ink-2);white-space:nowrap}
.pill.pass{color:var(--ok);border-color:currentColor}
.pill.fail{color:var(--bad);border-color:currentColor}
.pill.skip{color:var(--ink-3)}
.pill.band{background:var(--paper-2)}

/* Discovery graph. Fixed topology, so the "graph" is a grid of stages: no
   layout to compute, and the text stays selectable and in reading order.
   State is carried by a word in every node, never by colour alone — the border
   is reinforcement for people who can see it, not the message. */
.graph{margin:26px 0;padding:0}
.graph figcaption{color:var(--ink-2);font-size:.92rem;margin-bottom:18px;max-width:62ch}
.gstage{font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;margin:18px 0 8px}
.grow{list-style:none;padding:0;margin:0;display:grid;gap:10px;
  grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.gnode{border:1px solid var(--line);border-left-width:3px;border-radius:var(--radius);
  padding:12px 14px;background:var(--card)}
.gnode p{margin:0 0 5px}
.gnode p:last-child{margin-bottom:0}
.gstate{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;font-weight:600;
  color:var(--ink-3)}
.glabel{font-weight:600}
.gmethod{font-size:.82rem;color:var(--ink-2);word-break:break-word}
.gnode[data-state="observed"]{border-left-color:var(--ok)}
.gnode[data-state="observed"] .gstate{color:var(--ok)}
.gnode[data-state="observed_not_followed"]{border-left-color:var(--warn);
  border-left-style:dashed}
.gnode[data-state="observed_not_followed"] .gstate{color:var(--warn)}
.gnode[data-state="absent"]{border-left-color:var(--bad)}
.gnode[data-state="absent"] .gstate{color:var(--bad)}
.gnode[data-state="blocked"]{border-left-style:dotted}
.gnode[data-state="outside_profile"],
.gnode[data-state="not_in_run"],
.gnode[data-state="not_in_profile"]{background:none;border-style:dashed}

form.check{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}
form.check input{flex:1 1 260px;min-width:0;font:inherit;padding:13px 14px;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--card);color:var(--ink)}
/* --accent-btn, not --accent: white text on a mid-tone brand accent commonly
   fails AA once dark mode brightens it. min-height matches WCAG 2.5.5. */
.btn{display:inline-block;font:inherit;font-weight:600;padding:13px 22px;border:0;
  border-radius:var(--radius-btn);background:var(--accent-btn);color:#fff;cursor:pointer;
  min-height:44px}
.btn:hover{background:var(--accent-btn-hover);color:#fff;text-decoration:none}

.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:20px;margin:18px 0}
.cta{background:var(--paper-2);border-color:var(--accent);margin-top:36px}
.cta h2{margin-top:0;font-size:1.25rem}
.cta p{color:var(--ink-2);max-width:60ch}
.cta p:last-child{margin-bottom:0}
.fix{border-left:3px solid var(--accent);padding-left:14px;margin:14px 0}
.fix h3{margin:0 0 .3em;font-size:1rem}
.note{font-size:.9rem;color:var(--ink-3)}
figure{margin:20px 0}
figure svg{max-width:100%;height:auto;display:block}
figcaption{font-size:.85rem;color:var(--ink-3);margin-top:.5em}

footer.bot{border-top:1px solid var(--line);padding:26px 0;color:var(--ink-3);font-size:.88rem}
footer.bot a{color:var(--ink-2)}
`;

/** The full stylesheet for a theme: font faces, tokens, then structure. */
export function censusStylesheet(theme: CensusTheme): string {
  return `${renderThemeCss(theme)}\n${STRUCTURE_CSS}`;
}

/** Exported for tests that assert the structure is free of brand-specific names. */
export { STRUCTURE_CSS };
