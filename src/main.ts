import {
  App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile,
  WorkspaceLeaf, moment as obsidianMoment, normalizePath, requestUrl,
} from "obsidian";
import type { Moment } from "moment";
const moment = obsidianMoment as unknown as typeof import("moment");
import HOLIDAYS from "../data/holidays.json";
import COUNTRIES from "../data/countries.json";

const VIEW_TYPE = "world-calendar-notes-view";
const LOC_MON = "x-wcn-monday", LOC_SUN = "x-wcn-sunday";
/** Two private locales for week starts, without touching the app's own locale. */
function ensureWeekLocales() {
  const prev = moment.locale();
  const base = { parentLocale: prev || "en" } as moment.LocaleSpecification & { parentLocale: string };
  if (!moment.locales().includes(LOC_MON)) moment.defineLocale(LOC_MON, { ...base, week: { dow: 1, doy: 4 } });
  if (!moment.locales().includes(LOC_SUN)) moment.defineLocale(LOC_SUN, { ...base, week: { dow: 0, doy: 6 } });
  moment.locale(prev); // defineLocale switches the global locale; switch it back
}
// Set when the Gumroad product exists. Empty = licence check disabled (Pro stays locked).
const GUMROAD_PRODUCT_ID = "";
const BUY_URL = "https://lilambd.gumroad.com/l/world-calendar-notes";

type Period = "day" | "week" | "month" | "quarter" | "year";
const PERIODS: Period[] = ["day", "week", "month", "quarter", "year"];
const PERIOD_LABEL: Record<Period, string> = {
  day: "Daily", week: "Weekly", month: "Monthly", quarter: "Quarterly", year: "Yearly",
};

interface PeriodSettings { enabled: boolean; folder: string; format: string; template: string; }
interface Settings {
  periods: Record<Period, PeriodSettings>;
  weekStart: "locale" | "monday" | "sunday";
  showWeekNumbers: boolean;
  countries: string[];
  showHolidayCategories: "public" | "all";
  altCalendar: string;
  licenseKey: string;
  pro: boolean;
}

const DEFAULTS: Settings = {
  periods: {
    day: { enabled: true, folder: "", format: "YYYY-MM-DD", template: "" },
    week: { enabled: true, folder: "", format: "gggg-[W]ww", template: "" },
    month: { enabled: true, folder: "", format: "YYYY-MM", template: "" },
    quarter: { enabled: false, folder: "", format: "YYYY-[Q]Q", template: "" },
    year: { enabled: false, folder: "", format: "YYYY", template: "" },
  },
  weekStart: "locale",
  showWeekNumbers: true,
  countries: [],
  showHolidayCategories: "public",
  altCalendar: "",
  licenseKey: "",
  pro: false,
};

// Calendars supported by Intl in Electron/Chromium and mobile WebViews.
const ALT_CALENDARS: Record<string, string> = {
  "": "None",
  "islamic-umalqura": "Hijri (Umm al-Qura)",
  "hebrew": "Hebrew",
  "chinese": "Chinese",
  "persian": "Persian (Solar Hijri)",
  "japanese": "Japanese era",
  "buddhist": "Buddhist (Thai)",
  "coptic": "Coptic",
  "ethiopic": "Ethiopian",
  "indian": "Indian national (Saka)",
};

// ---------- holidays ----------
type HRow = [string, number, number, number, number]; // yymmdd, name idx, local name idx (-1 none), category idx, estimated
interface HData { cats: string[]; n: string[]; c: Record<string, HRow[]>; }
const H = HOLIDAYS as unknown as HData;
const C = COUNTRIES as unknown as Record<string, string>;
export interface Holiday { country: string; name: string; local: string; category: string; estimated: boolean; }

function holidaysFor(countries: string[], scope: "public" | "all"): Map<string, Holiday[]> {
  const out = new Map<string, Holiday[]>();
  for (const cc of countries) {
    for (const r of H.c[cc] ?? []) {
      const cat = H.cats[r[3]];
      if (scope === "public" && cat !== "public") continue;
      const key = "20" + r[0];
      const list = out.get(key) ?? [];
      list.push({ country: cc, name: H.n[r[1]], local: r[2] >= 0 ? H.n[r[2]] : "", category: cat, estimated: r[4] === 1 });
      out.set(key, list);
    }
  }
  return out;
}

function altDate(m: Moment, cal: string, long = false): string {
  if (!cal) return "";
  try {
    const opts: Intl.DateTimeFormatOptions = long
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "numeric" };
    return new Intl.DateTimeFormat(`en-u-ca-${cal}`, opts).format(m.toDate());
  } catch {
    return "";
  }
}

// ---------- plugin ----------
export default class WorldCalendarNotes extends Plugin {
  settings: Settings = DEFAULTS;
  holidayCache: Map<string, Holiday[]> = new Map();

  async onload() {
    ensureWeekLocales();
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.addRibbonIcon("calendar-days", "Open World Calendar", () => this.activateView());

    for (const p of PERIODS) {
      this.addCommand({
        id: `open-${p}`,
        name: `Open this ${p === "day" ? "day" : p}'s note`,
        callback: () => this.openPeriodNote(p, moment(), false),
      });
    }
    this.addCommand({ id: "next-note", name: "Open next note (same period)", callback: () => this.stepActive(1) });
    this.addCommand({ id: "prev-note", name: "Open previous note (same period)", callback: () => this.stepActive(-1) });
    this.addCommand({ id: "open-view", name: "Show calendar", callback: () => this.activateView() });

    this.addSettingTab(new WCNSettingTab(this.app, this));

    const refresh = (f: TAbstractFile) => { if (f instanceof TFile && f.extension === "md") this.refreshViews(); };
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.registerInterval(window.setInterval(() => this.refreshViews(true), 60 * 1000));

    this.app.workspace.onLayoutReady(() => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length === 0) this.activateView(false);
    });
  }

  onunload() {}

  async loadSettings() {
    const saved = (await this.loadData()) ?? {};
    this.settings = Object.assign({}, DEFAULTS, saved);
    this.settings.periods = Object.assign({}, DEFAULTS.periods, saved.periods ?? {});
    for (const p of PERIODS) this.settings.periods[p] = Object.assign({}, DEFAULTS.periods[p], this.settings.periods[p]);
    this.rebuildHolidays();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.rebuildHolidays();
    this.refreshViews();
  }

  /** Free: one country, public holidays. Pro: many countries, all categories, second calendar. */
  activeCountries(): string[] {
    return this.settings.pro ? this.settings.countries : this.settings.countries.slice(0, 1);
  }
  activeAltCalendar(): string { return this.settings.pro ? this.settings.altCalendar : ""; }

  rebuildHolidays() {
    const scope = this.settings.pro ? this.settings.showHolidayCategories : "public";
    this.holidayCache = holidaysFor(this.activeCountries(), scope);
  }

  holidaysOn(m: Moment): Holiday[] { return this.holidayCache.get(m.format("YYYYMMDD")) ?? []; }

  // ----- week handling -----
  weekMoment(m: Moment): Moment {
    const c = m.clone();
    if (this.settings.weekStart === "monday") c.locale(LOC_MON);
    else if (this.settings.weekStart === "sunday") c.locale(LOC_SUN);
    return c;
  }

  // ----- paths -----
  pathFor(p: Period, m: Moment): string {
    const s = this.settings.periods[p];
    const name = this.weekMoment(m).format(s.format);
    return normalizePath(`${s.folder ? s.folder + "/" : ""}${name}.md`);
  }

  fileFor(p: Period, m: Moment): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(this.pathFor(p, m));
    return f instanceof TFile ? f : null;
  }

  parseActive(): { p: Period; m: Moment } | null {
    const f = this.app.workspace.getActiveFile();
    if (!f) return null;
    for (const p of PERIODS) {
      const s = this.settings.periods[p];
      if (!s.enabled) continue;
      const folder = normalizePath(s.folder || "/");
      const parent = f.parent ? normalizePath(f.parent.path || "/") : "/";
      const rel = s.folder ? f.path.slice(folder.length + 1).replace(/\.md$/, "") : f.path.replace(/\.md$/, "");
      if (s.folder && !f.path.startsWith(folder + "/")) continue;
      if (!s.folder && s.format.indexOf("/") < 0 && parent !== "/") continue;
      const m = this.weekMoment(moment()).clone();
      const parsed = moment(rel, s.format, m.locale(), true);
      if (parsed.isValid()) return { p, m: parsed };
    }
    return null;
  }

  async stepActive(dir: number) {
    const cur = this.parseActive();
    if (!cur) { new Notice("This note is not a periodic note."); return; }
    const unit = cur.p === "day" ? "day" : cur.p === "week" ? "week" : cur.p === "month" ? "month" : cur.p === "quarter" ? "quarter" : "year";
    await this.openPeriodNote(cur.p, cur.m.clone().add(dir, unit), false);
  }

  // ----- create / open -----
  async openPeriodNote(p: Period, m: Moment, newLeaf: boolean) {
    const s = this.settings.periods[p];
    if (!s.enabled) { new Notice(`${PERIOD_LABEL[p]} notes are turned off in settings.`); return; }
    let file = this.fileFor(p, m);
    if (!file) file = await this.createNote(p, m);
    await this.app.workspace.getLeaf(newLeaf).openFile(file);
  }

  async createNote(p: Period, m: Moment): Promise<TFile> {
    const path = this.pathFor(p, m);
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => {});
    const body = await this.renderTemplate(p, m);
    return this.app.vault.create(path, body);
  }

  async renderTemplate(p: Period, m: Moment): Promise<string> {
    const s = this.settings.periods[p];
    let tpl = "";
    if (s.template) {
      const tp = normalizePath(s.template.endsWith(".md") ? s.template : s.template + ".md");
      const f = this.app.vault.getAbstractFileByPath(tp);
      if (f instanceof TFile) tpl = await this.app.vault.read(f);
      else new Notice(`Template not found: ${tp}`);
    }
    const wm = this.weekMoment(m);
    const title = wm.format(s.format);
    const hol: (Holiday & { date?: string })[] = p === "day" ? this.holidaysOn(m) : this.holidaysInRange(p, m);
    const holText = hol.map((h) => `- ${h.date ? h.date + " " : ""}${h.name}${h.local ? ` (${h.local})` : ""} — ${C[h.country] ?? h.country}${h.estimated ? " (estimated)" : ""}`).join("\n");
    const now = moment();
    return tpl
      .replace(/{{\s*title\s*}}/gi, title)
      .replace(/{{\s*date\s*}}/gi, m.format("YYYY-MM-DD"))
      .replace(/{{\s*time\s*}}/gi, now.format("HH:mm"))
      .replace(/{{\s*date:([^}]+)}}/gi, (_x, f: string) => wm.format(f.trim()))
      .replace(/{{\s*(yesterday|tomorrow)\s*}}/gi, (_x, w: string) => m.clone().add(w.toLowerCase() === "yesterday" ? -1 : 1, "day").format(this.settings.periods.day.format))
      .replace(/{{\s*holidays\s*}}/gi, holText)
      .replace(/{{\s*altdate\s*}}/gi, altDate(m, this.activeAltCalendar(), true));
  }

  holidaysInRange(p: Period, m: Moment): (Holiday & { date?: string })[] {
    const wm = this.weekMoment(m);
    const unit = p === "week" ? "week" : p === "month" ? "month" : p === "quarter" ? "quarter" : "year";
    const start = wm.clone().startOf(unit), end = wm.clone().endOf(unit);
    const out: (Holiday & { date?: string })[] = [];
    for (const d = start.clone(); d.isSameOrBefore(end, "day"); d.add(1, "day")) {
      for (const h of this.holidaysOn(d)) out.push({ ...h, date: d.format("YYYY-MM-DD") });
    }
    return out;
  }

  // ----- view -----
  async activateView(reveal = true) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const right = ws.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (reveal) ws.revealLeaf(leaf);
  }

  refreshViews(onlyIfDayChanged = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v instanceof CalendarView) v.refresh(onlyIfDayChanged);
    }
  }

  // ----- licence -----
  async verifyLicense(key: string): Promise<boolean> {
    if (!GUMROAD_PRODUCT_ID) { new Notice("Licence check is not set up in this build yet."); return false; }
    try {
      const r = await requestUrl({
        url: "https://api.gumroad.com/v2/licenses/verify",
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: `product_id=${encodeURIComponent(GUMROAD_PRODUCT_ID)}&license_key=${encodeURIComponent(key.trim())}&increment_uses_count=false`,
        throw: false,
      });
      const j = r.json;
      return !!(j && j.success && !j.purchase?.refunded && !j.purchase?.chargebacked);
    } catch {
      new Notice("Could not reach Gumroad. Check your connection.");
      return false;
    }
  }
}

// ---------- view ----------
class CalendarView extends ItemView {
  plugin: WorldCalendarNotes;
  shown: Moment = moment().startOf("month");
  today = moment().format("YYYY-MM-DD");

  constructor(leaf: WorkspaceLeaf, plugin: WorldCalendarNotes) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "World Calendar"; }
  getIcon() { return "calendar-days"; }
  async onOpen() { this.render(); }

  refresh(onlyIfDayChanged = false) {
    const t = moment().format("YYYY-MM-DD");
    if (onlyIfDayChanged && t === this.today) return;
    this.today = t;
    this.render();
  }

  render() {
    const P = this.plugin, S = P.settings;
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("wcn");
    const month = P.weekMoment(this.shown).startOf("month");

    // header
    const head = root.createDiv("wcn-head");
    const title = head.createDiv("wcn-title");
    const mEl = title.createSpan({ text: month.format("MMMM"), cls: "wcn-link" });
    mEl.onclick = (e) => P.openPeriodNote("month", month, e.ctrlKey || e.metaKey);
    title.appendText(" ");
    const yEl = title.createSpan({ text: month.format("YYYY"), cls: "wcn-link wcn-year" });
    yEl.onclick = (e) => P.openPeriodNote("year", month, e.ctrlKey || e.metaKey);
    title.appendText(" ");
    const qEl = title.createSpan({ text: "Q" + month.format("Q"), cls: "wcn-link wcn-q" });
    qEl.onclick = (e) => P.openPeriodNote("quarter", month, e.ctrlKey || e.metaKey);
    for (const [p, el] of [["month", mEl], ["year", yEl], ["quarter", qEl]] as [Period, HTMLElement][]) {
      if (!S.periods[p].enabled) el.removeClass("wcn-link");
      if (P.fileFor(p, month)) el.addClass("wcn-has");
    }
    const nav = head.createDiv("wcn-nav");
    const btn = (t: string, label: string, fn: () => void) => {
      const b = nav.createEl("button", { text: t, attr: { "aria-label": label } }); b.onclick = fn;
    };
    btn("‹", "Previous month", () => { this.shown = this.shown.clone().subtract(1, "month"); this.render(); });
    btn("Today", "This month", () => { this.shown = moment().startOf("month"); this.render(); });
    btn("›", "Next month", () => { this.shown = this.shown.clone().add(1, "month"); this.render(); });

    // grid
    const alt = P.activeAltCalendar();
    const table = root.createEl("table", { cls: "wcn-grid" });
    const thead = table.createEl("thead").createEl("tr");
    if (S.showWeekNumbers) thead.createEl("th", { text: "W", cls: "wcn-wk" });
    const first = month.clone().startOf("week");
    for (let i = 0; i < 7; i++) thead.createEl("th", { text: first.clone().add(i, "day").format("dd") });
    const tbody = table.createEl("tbody");
    const last = month.clone().endOf("month").endOf("week");
    for (let w = first.clone(); w.isSameOrBefore(last, "day"); w.add(1, "week")) {
      const tr = tbody.createEl("tr");
      if (S.showWeekNumbers) {
        const td = tr.createEl("td", { text: w.format("w"), cls: "wcn-wk" });
        if (S.periods.week.enabled) {
          td.addClass("wcn-link");
          const wk = w.clone();
          td.onclick = (e) => P.openPeriodNote("week", wk, e.ctrlKey || e.metaKey);
          if (P.fileFor("week", wk)) td.addClass("wcn-has");
        }
      }
      for (let i = 0; i < 7; i++) {
        const d = w.clone().add(i, "day");
        const td = tr.createEl("td", { cls: "wcn-day" });
        if (d.month() !== month.month()) td.addClass("wcn-out");
        if (d.format("YYYY-MM-DD") === this.today) td.addClass("wcn-today");
        const hol = P.holidaysOn(d);
        if (hol.length) {
          td.addClass("wcn-hol");
          td.setAttr("aria-label", hol.map((h) => `${h.name} (${h.country})`).join("\n"));
        }
        td.createDiv({ text: d.format("D"), cls: "wcn-num" });
        if (alt) td.createDiv({ text: altDate(d, alt), cls: "wcn-alt" });
        const dots = td.createDiv("wcn-dots");
        if (P.fileFor("day", d)) dots.createSpan({ cls: "wcn-dot" });
        const dd = d.clone();
        td.onclick = (e) => P.openPeriodNote("day", dd, e.ctrlKey || e.metaKey);
      }
    }

    // holiday list for the month
    const countries = P.activeCountries();
    if (countries.length) {
      const list = root.createDiv("wcn-list");
      const end = month.clone().endOf("month");
      let any = false;
      for (const d = month.clone(); d.isSameOrBefore(end, "day"); d.add(1, "day")) {
        for (const h of P.holidaysOn(d)) {
          any = true;
          const row = list.createDiv("wcn-row");
          row.createSpan({ text: d.format("D ddd"), cls: "wcn-row-date" });
          row.createSpan({ text: `${h.name}${h.estimated ? " *" : ""}`, cls: "wcn-row-name" });
          if (countries.length > 1) row.createSpan({ text: h.country, cls: "wcn-row-cc" });
        }
      }
      if (!any) list.createDiv({ text: "No holidays this month.", cls: "wcn-muted" });
      if (month.year() > 2030 || month.year() < 2026) list.createDiv({ text: "Holiday data covers 2026–2030.", cls: "wcn-muted" });
    } else {
      root.createDiv({ text: "Pick a country in settings to see public holidays.", cls: "wcn-muted" });
    }
    if (alt) root.createDiv({ text: `${ALT_CALENDARS[alt]}: ${altDate(moment(), alt, true)}`, cls: "wcn-muted" });
  }
}

// ---------- settings ----------
class WCNSettingTab extends PluginSettingTab {
  plugin: WorldCalendarNotes;
  constructor(app: App, plugin: WorldCalendarNotes) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl: el } = this;
    const P = this.plugin, S = P.settings;
    el.empty();

    new Setting(el).setName("Calendar").setHeading();
    new Setting(el).setName("Week starts on").addDropdown((d) => d
      .addOptions({ locale: "Follow app language", monday: "Monday (ISO)", sunday: "Sunday" })
      .setValue(S.weekStart).onChange(async (v) => { S.weekStart = v as Settings["weekStart"]; await P.saveSettings(); }));
    new Setting(el).setName("Show week numbers").addToggle((t) => t
      .setValue(S.showWeekNumbers).onChange(async (v) => { S.showWeekNumbers = v; await P.saveSettings(); }));

    for (const p of PERIODS) {
      const s = S.periods[p];
      new Setting(el).setName(`${PERIOD_LABEL[p]} notes`).setHeading();
      new Setting(el).setName("Turn on").addToggle((t) => t.setValue(s.enabled).onChange(async (v) => { s.enabled = v; await P.saveSettings(); this.display(); }));
      if (!s.enabled) continue;
      new Setting(el).setName("Folder").addText((t) => t.setPlaceholder("Vault root").setValue(s.folder)
        .onChange(async (v) => { s.folder = v.replace(/\/+$/, ""); await P.saveSettings(); }));
      new Setting(el).setName("File name format").setDesc("Moment.js format, e.g. YYYY-MM-DD or YYYY/MM/YYYY-MM-DD.")
        .addText((t) => t.setValue(s.format).onChange(async (v) => { s.format = v || DEFAULTS.periods[p].format; await P.saveSettings(); }));
      new Setting(el).setName("Template file").setDesc("Variables: {{title}} {{date}} {{date:FORMAT}} {{time}} {{yesterday}} {{tomorrow}} {{holidays}} {{altdate}}")
        .addText((t) => t.setPlaceholder("Templates/Daily").setValue(s.template).onChange(async (v) => { s.template = v; await P.saveSettings(); }));
    }

    new Setting(el).setName("Holidays").setHeading();
    const names = Object.entries(C).sort((a, b) => a[1].localeCompare(b[1]));
    new Setting(el).setName("Country").setDesc(S.pro ? "Add as many countries as you like." : "Free version: one country. Pro: any number of countries.")
      .addDropdown((d) => {
        d.addOption("", "— add a country —");
        for (const [cc, n] of names) d.addOption(cc, `${n} (${cc})`);
        d.onChange(async (v) => {
          if (!v) return;
          if (!S.pro) S.countries = [v];
          else if (!S.countries.includes(v)) S.countries.push(v);
          await P.saveSettings(); this.display();
        });
      });
    for (const cc of S.countries) {
      const off = !S.pro && cc !== S.countries[0];
      new Setting(el).setName(`${C[cc] ?? cc} (${cc})`).setDesc(off ? "Needs Pro" : "")
        .addExtraButton((b) => b.setIcon("x").setTooltip("Remove").onClick(async () => {
          S.countries = S.countries.filter((x) => x !== cc); await P.saveSettings(); this.display();
        }));
    }
    new Setting(el).setName("Holiday types").setDesc(S.pro ? "" : "Pro shows bank, optional, religious and school days too.")
      .addDropdown((d) => d.addOptions({ public: "Public holidays", all: "All types" }).setValue(S.showHolidayCategories)
        .setDisabled(!S.pro).onChange(async (v) => { S.showHolidayCategories = v as Settings["showHolidayCategories"]; await P.saveSettings(); }));

    new Setting(el).setName("Second calendar").setDesc(S.pro ? "Shows each day's date in another calendar." : "Pro feature.")
      .addDropdown((d) => d.addOptions(ALT_CALENDARS).setValue(S.altCalendar).setDisabled(!S.pro)
        .onChange(async (v) => { S.altCalendar = v; await P.saveSettings(); }));

    new Setting(el).setName("Pro").setHeading();
    new Setting(el)
      .setName(S.pro ? "Pro is active. Thank you!" : "Licence key")
      .setDesc(S.pro ? "" : "Pro is a one-time purchase. The key is checked once with Gumroad; nothing else is sent.")
      .addText((t) => t.setPlaceholder("XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX").setValue(S.licenseKey).onChange((v) => { S.licenseKey = v.trim(); }))
      .addButton((b) => b.setButtonText(S.pro ? "Re-check" : "Activate").onClick(async () => {
        const ok = await P.verifyLicense(S.licenseKey);
        S.pro = ok;
        await P.saveSettings();
        new Notice(ok ? "Pro activated." : "That key did not work.");
        this.display();
      }))
      .addButton((b) => b.setButtonText("Buy Pro").onClick(() => window.open(BUY_URL)));
    el.createEl("p", {
      cls: "setting-item-description",
      text: "Holiday data: python-holidays (MIT), 2026–2030, checked by Lilambd Crossing. Dates marked * depend on moon sighting and may move by a day.",
    });
  }
}
export { CalendarView };
