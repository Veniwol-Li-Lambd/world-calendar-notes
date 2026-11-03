import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>"); globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.HTMLElement = dom.window.HTMLElement;
const P = dom.window.HTMLElement.prototype;
P.createEl = function(tag, o={}){ const e=document.createElement(tag); if(typeof o==='string') o={cls:o}; if(o.text) e.textContent=o.text; if(o.cls) e.className=o.cls; if(o.attr) for(const k in o.attr) e.setAttribute(k,o.attr[k]); this.appendChild(e); return e; };
P.createDiv = function(o){ return this.createEl('div', typeof o==='string'?{cls:o}:o); };
P.createSpan = function(o){ return this.createEl('span', typeof o==='string'?{cls:o}:o); };
P.empty = function(){ this.innerHTML=''; }; P.addClass=function(c){this.classList.add(c)}; P.removeClass=function(c){this.classList.remove(c)}; P.setAttr=function(k,v){this.setAttribute(k,v)}; P.appendText=function(t){this.appendChild(document.createTextNode(t))};
const { createRequire } = await import("module"); const require = createRequire(import.meta.url);
const mod = require("./bundle.cjs"); const ob = globalThis.__mock;
const Plugin = mod.default; const p = new Plugin(); p._data = { countries:["JP","US"], pro:false, periods:{ day:{folder:"Daily", template:"T/Daily"} } };
await p.onload();
const ok=(c,m)=>{ console.log((c?"PASS ":"FAIL ")+m); if(!c) process.exitCode=1; };
const m = ob.moment("2026-01-01");
ok(p.pathFor("day",m)==="Daily/2026-01-01.md","daily path "+p.pathFor("day",m));
ok(p.holidaysOn(m).length===1 && p.holidaysOn(m)[0].country==="JP","free: only first country (JP) "+JSON.stringify(p.holidaysOn(m)));
ok(p.activeAltCalendar()==="","free: no alt calendar");
p.settings.pro=true; p.settings.altCalendar="hebrew"; p.rebuildHolidays();
ok(p.holidaysOn(m).length===2,"pro: JP+US on Jan 1 -> "+p.holidaysOn(m).map(h=>h.country+':'+h.name).join(', '));
// template
ob.__t.files.set("T/Daily.md", Object.assign(new ob.TFile("T/Daily.md"),{body:"# {{title}}\n{{date:dddd}} {{altdate}}\nprev [[{{yesterday}}]]\n{{holidays}}\n"}));
await p.openPeriodNote("day", m, false);
console.log("notices",ob.__t.notices,"opened",ob.__t.opened,"files",[...ob.__t.files.keys()]); const [path, body] = ob.__t.created.at(-1); console.log(body);
ok(path==="Daily/2026-01-01.md" && body.includes("Thursday") && body.includes("New Year") && body.includes("Tevet") && body.includes("[[2025-12-31]]"),"template rendered");
ok(ob.__t.opened.at(-1)==="Daily/2026-01-01.md","opened note");
// week (ISO)
p.settings.weekStart="monday"; p.settings.periods.week.enabled=true;
ok(p.pathFor("week",ob.moment("2026-01-01"))==="2026-W01.md","ISO week path "+p.pathFor("week",ob.moment("2026-01-01")));
ok(p.pathFor("quarter",ob.moment("2026-11-03"))==="2026-Q4.md","quarter path");
// week template holidays range
const wk = p.holidaysInRange("month", ob.moment("2026-05-01")); ok(wk.length>=3,"May holidays JP+US: "+wk.length);
// next/prev
ob.__t.workspace._active = ob.__t.files.get("Daily/2026-01-01.md");
await p.stepActive(1); ok(ob.__t.opened.at(-1)==="Daily/2026-01-02.md","next daily note -> "+ob.__t.opened.at(-1));
// view render
const { CalendarView } = mod;
p.settings.weekStart="monday"; p.settings.countries=["JP","US","IN"]; p.settings.altCalendar="islamic-umalqura"; p.rebuildHolidays();
const v = new CalendarView({}, p); v.shown = ob.moment("2026-11-01"); v.today="2026-11-03"; v.render();
const root = v.containerEl.children[1];
ok(root.querySelectorAll("td.wcn-day").length===35 || root.querySelectorAll("td.wcn-day").length===42,"grid cells "+root.querySelectorAll("td.wcn-day").length);
ok(root.querySelector(".wcn-today .wcn-num").textContent==="3","today highlighted");
const hol=[...root.querySelectorAll(".wcn-row")].map(r=>r.textContent); ok(hol.length>=4,"Nov holidays list "+hol.length+": "+hol.join(" | "));
ok(root.querySelector(".wcn-alt")?.textContent.length>0,"alt date shown "+root.querySelector(".wcn-alt")?.textContent);
const fs = await import("fs"); fs.writeFileSync("test/view.html", root.outerHTML);
ok(root.querySelector("thead th:nth-child(2)").textContent==="Mo","monday start header "+root.querySelector("thead th:nth-child(2)").textContent);
ok(ob.moment.locale()==="en","global locale untouched: "+ob.moment.locale());
p.settings.weekStart="sunday"; ok(p.pathFor("week",ob.moment("2026-01-04"))==="2026-W02.md","sunday-start week path "+p.pathFor("week",ob.moment("2026-01-04")));
p.settings.weekStart="monday"; ok(p.pathFor("week",ob.moment("2026-01-04"))==="2026-W01.md","monday-start week path "+p.pathFor("week",ob.moment("2026-01-04")));
process.exit(process.exitCode ?? 0);
