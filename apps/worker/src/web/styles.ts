/**
 * The census stylesheet, served from the Worker at `/census/assets/census.css`.
 *
 * An external sheet rather than inline style, because the Worker's CSP is
 * `style-src 'self'` with no `unsafe-inline` — see apps/worker/src/security.ts.
 * The main site's build-time CSP hashes can never cover Worker-rendered HTML, so
 * we avoid needing hashes at all.
 *
 * Tokens are lifted from the live radixia.ai (read 2026-08-05) so the census
 * reads as part of the site rather than a bolt-on. Fonts are referenced from the
 * main site's own `/fonts/` — same origin once routed under www.radixia.ai, and
 * they degrade to the system stack anywhere else.
 */
export const CENSUS_CSS = `
@font-face{font-family:"Public Sans";src:url("/fonts/public-sans-latin-var.woff2")format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Fraunces";src:url("/fonts/fraunces-latin-var.woff2")format("woff2");font-weight:100 900;font-display:swap}

:root{
  --font-body:"Public Sans",system-ui,sans-serif;
  --font-display:"Fraunces",Georgia,serif;
  --font-mono:"JetBrains Mono",ui-monospace,monospace;
  --paper:#fbf9fb; --paper-2:#f4eef4; --card:#fff;
  --ink:#1a1023; --ink-2:#4c3f58; --ink-3:#7d7188;
  --line:#e6dde8; --magenta:#d6117e; --magenta-deep:#9c0b5c;
  --radius:10px;
  --ok:#1b7f4b; --warn:#a86b00; --bad:#9c2b2b;
}
@media(prefers-color-scheme:dark){
  :root{
    --paper:#16101c; --paper-2:#211a29; --card:#1e1626;
    --ink:#efe8f4; --ink-2:#c6b8d2; --ink-3:#94869f;
    --line:#362b42; --magenta:#e5308f; --magenta-deep:#ff7ec0;
    --ok:#4fd18b; --warn:#e8b04b; --bad:#ff8f8f;
  }
}

*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-body);
  font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
a{color:var(--magenta);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3{font-family:var(--font-display);font-weight:600;line-height:1.15;margin:0 0 .5em}
h1{font-size:clamp(2rem,5vw,3.1rem)}
h2{font-size:clamp(1.4rem,3vw,2rem);margin-top:2.2em}
h3{font-size:1.15rem;margin-top:1.6em}
p{margin:0 0 1em}
code,.mono{font-family:var(--font-mono);font-size:.9em}

header.top{border-bottom:1px solid var(--line);background:var(--paper-2)}
header.top .wrap{display:flex;gap:20px;align-items:baseline;padding:14px 20px;flex-wrap:wrap}
header.top .brand{font-family:var(--font-display);font-weight:600;color:var(--ink)}
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
  line-height:1;color:var(--magenta);font-weight:600;display:block}
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

form.check{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}
form.check input{flex:1 1 260px;min-width:0;font:inherit;padding:13px 14px;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--card);color:var(--ink)}
.btn{display:inline-block;font:inherit;font-weight:600;padding:13px 22px;border:0;
  border-radius:var(--radius);background:var(--magenta);color:#fff;cursor:pointer}
.btn:hover{background:var(--magenta-deep);text-decoration:none}

.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:20px;margin:18px 0}
.fix{border-left:3px solid var(--magenta);padding-left:14px;margin:14px 0}
.fix h3{margin:0 0 .3em;font-size:1rem}
.note{font-size:.9rem;color:var(--ink-3)}
figure{margin:20px 0}
figure svg{max-width:100%;height:auto;display:block}
figcaption{font-size:.85rem;color:var(--ink-3);margin-top:.5em}

footer.bot{border-top:1px solid var(--line);padding:26px 0;color:var(--ink-3);font-size:.88rem}
footer.bot a{color:var(--ink-2)}
`;
