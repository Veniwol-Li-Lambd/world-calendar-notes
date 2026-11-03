const { chromium } = require('playwright'); const fs=require('fs');
const view=fs.readFileSync('test/view.html','utf8'), css=fs.readFileSync('styles.css','utf8');
const html=`<html><head><style>
:root{--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-hover:#ffffff14;--background-modifier-border:#3a3a3a;--text-normal:#dcddde;--text-muted:#a3a3a3;--text-faint:#6f6f6f;--text-error:#fb6464;--interactive-accent:#8a5cf5;--text-on-accent:#fff;--font-ui-small:15px;--font-ui-smaller:12px;--font-ui-medium:18px}
body{margin:0;background:#161616;color:var(--text-normal);font-family:Inter,system-ui,sans-serif;width:1280px;height:720px;display:flex;align-items:center}
.l{flex:1;padding:0 56px}.l h1{font-size:46px;margin:0 0 14px;color:#fff}.l p{font-size:20px;color:#bbb;line-height:1.45;margin:0 0 12px}.l .s{color:#8a8a8a;font-size:15px}
.r{width:430px;margin-right:56px;background:var(--background-secondary);border-radius:14px;padding:14px;box-shadow:0 10px 40px #0008}
button{background:#333;color:#ddd;border:0;border-radius:6px;font-size:13px}
${css}</style></head><body><div class="l"><h1>World Calendar Notes</h1>
<p>Daily, weekly, monthly, quarterly and yearly notes from one calendar.</p>
<p>Public holidays for 247 countries, built in and offline.</p>
<p>Each day's date in Hijri, Hebrew, Chinese, Persian, Japanese era and 4 more calendars.</p>
<p class="s">Plugin for Obsidian · Free, with Pro · Lilambd Crossing</p></div><div class="r">${view}</div></body></html>`;
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:720},deviceScaleFactor:2});await p.setContent(html);await p.screenshot({path:'test/cover.png'});await b.close();})();
