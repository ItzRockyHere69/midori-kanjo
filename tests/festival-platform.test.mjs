import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 3 keeps its calendar and tasks local in Dexie v7", async () => {
  const [db, festivals, sync] = await Promise.all([
    read("lib/db.ts"),
    read("lib/festivals.ts"),
    read("lib/sync.ts"),
  ]);
  assert.match(db, /this\.version\(7\)\.stores\(\{[\s\S]*?festivalEntries:[\s\S]*?festivalTasks:/);
  assert.match(db, /festivalEntries!:[\s\S]*?festivalTasks!:/);
  assert.match(festivals, /ensureFestivalCalendar/);
  assert.match(festivals, /normalizeMergedFestivalTags/);
  assert.match(sync, /await pullRemote\(supabase\);[\s\S]*await normalizeMergedFestivalTags\(\);[\s\S]*db\.items\.filter/);
  assert.match(festivals, /setFestivalTaskCompleted/);
  assert.doesNotMatch(festivals, /supabase|fetch\(|XMLHttpRequest|WebSocket/i);
});

test("festival planning reuses item festivalTags and preserves the five phone tabs", async () => {
  const [app, festivals, advancedReports] = await Promise.all([
    read("app/BillingApp.tsx"),
    read("lib/festivals.ts"),
    read("app/AdvancedReports.tsx"),
  ]);
  assert.match(app, /type ItemsMode = "catalogue" \| "inventory" \| "festival"/);
  assert.match(app, /<FestivalWorkspace[\s\S]*?items=\{reportItems\}/);
  assert.match(app, /<fieldset className="festival-product-field/);
  assert.match(app, /withFestivalKeys\([\s\S]*?withVariantFamily|withVariantFamily\([\s\S]*?withFestivalKeys/);
  assert.match(app, /const mobilePrimaryKeys: Tab\[\] = \["bill", "parties", "items", "reports", "more"\]/);
  assert.match(festivals, /family:[\s\S]*?aliasOf:|managedFestivalTags/);
  assert.match(festivals, /aliases: \["diwali"\]/);
  assert.match(app, /onOpenReports=\{\(\) => \{[\s\S]*?setReportsInitialView\("dead"\)[\s\S]*?setTab\("reports"\)/);
  assert.match(app, /initialAdvancedReport=\{reportsInitialView\}/);
  assert.match(advancedReports, /useState<ReportKey>\(initialReport\)/);
  assert.match(advancedReports, /id="dead-stock-report"/);
  assert.match(advancedReports, /scrollIntoView/);
  assert.match(advancedReports, /tabIndex=\{-1\}/);
});

test("festival workspace exposes calendar, bulk tags, comparisons and leftovers in all app languages", async () => {
  const [workspace, copy, css] = await Promise.all([
    read("app/FestivalWorkspace.tsx"),
    read("app/festival-copy.ts"),
    read("app/globals.css"),
  ]);
  assert.match(workspace, /"dashboard" \| "calendar" \| "tagging" \| "comparison" \| "leftovers"/);
  assert.match(workspace, /selectAllFiltered/);
  assert.match(workspace, /showMoreProducts/);
  assert.match(workspace, /buildFestivalPlan/);
  assert.match(workspace, /buildPostSeasonLeftovers/);
  assert.match(workspace, /useLiveToday/);
  assert.match(copy, /सीज़न प्लानर/);
  assert.match(copy, /মরসুম পরিকল্পনা/);
  assert.match(copy, /No tracked prior season yet/);
  assert.match(css, /\.festival-tabs/);
  assert.match(css, /\.festival-product-select/);
  assert.match(css, /@media \(max-width:420px\)/);
});

test("festival calendar provides a wide responsive month grid with phase details", async () => {
  const [workspace, copy, festivals, css] = await Promise.all([
    read("app/FestivalWorkspace.tsx"),
    read("app/festival-copy.ts"),
    read("lib/festivals.ts"),
    read("app/globals.css"),
  ]);
  assert.match(festivals, /festivalCalendarMonthDays/);
  assert.match(festivals, /festivalCalendarActivities/);
  assert.match(workspace, /festival-year-spectrum/);
  assert.match(workspace, /festival-calendar-scroller/);
  assert.match(workspace, /moveMonth\(-1\)/);
  assert.match(workspace, /moveMonth\(1\)/);
  assert.match(workspace, /chooseYear\(currentYear, currentMonth\)/);
  assert.match(workspace, /aria-current=\{isToday \? "date" : undefined\}/);
  assert.match(workspace, /aria-expanded=\{isSelected\}/);
  assert.match(workspace, /aria-controls="festival-calendar-detail"/);
  assert.match(workspace, /role="region"/);
  assert.match(workspace, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(workspace, /closeDateDetails/);
  assert.match(workspace, /id=\{`festival-day-\$\{day\.date\}`\}/);
  assert.match(workspace, /disabled=\{calendarBusy\}/);
  assert.match(workspace, /planningWindowStart\(entry\)/);
  assert.match(copy, /organizingPeriod/);
  assert.match(copy, /festivalDates/);
  assert.match(copy, /startOrganizing/);
  assert.match(css, /\[data-festival-view="calendar"\] \{ max-width:1440px/);
  assert.match(css, /festival-calendar-scroller[\s\S]*overflow-x:auto/);
  assert.match(css, /festival-calendar-grid \{ display:grid; grid-template-columns:repeat\(7/);
  assert.match(css, /festival-calendar-day__date \{[\s\S]*min-height:44px/);
  assert.match(css, /festival-calendar-day__events>span \{[\s\S]*color:var\(--ink\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("2026 seeds and visibly provisional 2027 dates cover the Kolkata festival list", async () => {
  const festivals = await read("lib/festivals.ts");
  for (const key of [
    "saraswati_puja",
    "holi",
    "poila_boishakh",
    "rath_yatra",
    "janmashtami",
    "vishwakarma_puja",
    "durga_puja",
    "lakshmi_puja",
    "kali_puja",
    "bhai_phota",
    "christmas",
    "new_year",
    "republic_day",
    "independence_day",
    "wedding",
  ]) assert.match(festivals, new RegExp(`key: "${key}"`));
  assert.match(festivals, /2026:[\s\S]*?durga_puja: \{ startDate: "2026-10-17", endDate: "2026-10-21" \}/);
  assert.match(festivals, /2024:[\s\S]*?durga_puja: \{ startDate: "2024-10-09", endDate: "2024-10-12" \}/);
  assert.match(festivals, /2027:[\s\S]*?status: "provisional"/);
  assert.match(festivals, /wedding:[\s\S]*?status: "business_estimate"/);
});
