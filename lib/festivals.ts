import {
  db,
  isValidLocalDate,
  localDate,
  nowIso,
  type Category,
  type FestivalDateStatus,
  type FestivalEntry,
  type FestivalTask,
  type Invoice,
  type Item,
  type Language,
  type StockMovement,
} from "./db";
import { convertQuantity, roundQuantity } from "./inventory";

export type FestivalKey =
  | "saraswati_puja"
  | "holi"
  | "poila_boishakh"
  | "rath_yatra"
  | "janmashtami"
  | "vishwakarma_puja"
  | "durga_puja"
  | "lakshmi_puja"
  | "kali_puja"
  | "bhai_phota"
  | "christmas"
  | "new_year"
  | "republic_day"
  | "independence_day"
  | "wedding";

export interface FestivalDefinition {
  key: FestivalKey;
  nameEn: string;
  nameHi: string;
  nameBn: string;
  defaultLeadTimeWeeks: number;
  aliases?: string[];
  isRange?: boolean;
}

export const FESTIVAL_DEFINITIONS: readonly FestivalDefinition[] = [
  { key: "saraswati_puja", nameEn: "Saraswati Puja", nameHi: "सरस्वती पूजा", nameBn: "সরস্বতী পূজা", defaultLeadTimeWeeks: 4 },
  { key: "holi", nameEn: "Holi", nameHi: "होली", nameBn: "দোলযাত্রা / হোলি", defaultLeadTimeWeeks: 4, isRange: true },
  { key: "poila_boishakh", nameEn: "Poila Boishakh", nameHi: "पोइला बोइशाख", nameBn: "পয়লা বৈশাখ", defaultLeadTimeWeeks: 4 },
  { key: "rath_yatra", nameEn: "Rath Yatra", nameHi: "रथ यात्रा", nameBn: "রথযাত্রা", defaultLeadTimeWeeks: 4 },
  { key: "janmashtami", nameEn: "Janmashtami", nameHi: "जन्माष्टमी", nameBn: "জন্মাষ্টমী", defaultLeadTimeWeeks: 4 },
  { key: "vishwakarma_puja", nameEn: "Vishwakarma Puja", nameHi: "विश्वकर्मा पूजा", nameBn: "বিশ্বকর্মা পূজা", defaultLeadTimeWeeks: 4 },
  { key: "durga_puja", nameEn: "Durga Puja", nameHi: "दुर्गा पूजा", nameBn: "দুর্গাপূজা", defaultLeadTimeWeeks: 4, isRange: true },
  { key: "lakshmi_puja", nameEn: "Lakshmi Puja", nameHi: "लक्ष्मी पूजा", nameBn: "লক্ষ্মীপূজা", defaultLeadTimeWeeks: 4 },
  { key: "kali_puja", nameEn: "Kali Puja / Diwali", nameHi: "काली पूजा / दिवाली", nameBn: "কালীপূজা / দীপাবলি", defaultLeadTimeWeeks: 4, aliases: ["diwali"], isRange: true },
  { key: "bhai_phota", nameEn: "Bhai Phota", nameHi: "भाई दूज / भाई फोटा", nameBn: "ভাইফোঁটা", defaultLeadTimeWeeks: 4 },
  { key: "christmas", nameEn: "Christmas", nameHi: "क्रिसमस", nameBn: "বড়দিন", defaultLeadTimeWeeks: 4 },
  { key: "new_year", nameEn: "New Year", nameHi: "नया साल", nameBn: "নববর্ষ", defaultLeadTimeWeeks: 4 },
  { key: "republic_day", nameEn: "Republic Day", nameHi: "गणतंत्र दिवस", nameBn: "প্রজাতন্ত্র দিবস", defaultLeadTimeWeeks: 4 },
  { key: "independence_day", nameEn: "Independence Day", nameHi: "स्वतंत्रता दिवस", nameBn: "স্বাধীনতা দিবস", defaultLeadTimeWeeks: 4 },
  { key: "wedding", nameEn: "Wedding Season", nameHi: "शादी का सीज़न", nameBn: "বিয়ের মরসুম", defaultLeadTimeWeeks: 4, aliases: ["wedding_season"], isRange: true },
] as const;

export const FESTIVAL_KEYS = FESTIVAL_DEFINITIONS.map((entry) => entry.key);
const definitionByKey = new Map(FESTIVAL_DEFINITIONS.map((entry) => [entry.key, entry]));

type DateSeed = {
  startDate: string;
  endDate?: string;
  status?: FestivalDateStatus;
  sourceNote?: string;
};

/**
 * Kolkata/West Bengal planning seeds. They are starting points only: every
 * value is editable in the app, and provisional values are visibly labelled.
 */
export const FESTIVAL_DATE_SEEDS: Readonly<Record<number, Partial<Record<FestivalKey, DateSeed>>>> = {
  2024: {
    saraswati_puja: { startDate: "2024-02-14" },
    holi: { startDate: "2024-03-25", endDate: "2024-03-26" },
    poila_boishakh: { startDate: "2024-04-14" },
    rath_yatra: { startDate: "2024-07-07" },
    janmashtami: { startDate: "2024-08-26" },
    vishwakarma_puja: { startDate: "2024-09-17" },
    durga_puja: { startDate: "2024-10-09", endDate: "2024-10-12" },
    lakshmi_puja: { startDate: "2024-10-16" },
    kali_puja: { startDate: "2024-10-31", endDate: "2024-11-01" },
    bhai_phota: { startDate: "2024-11-03" },
    christmas: { startDate: "2024-12-25" },
    new_year: { startDate: "2024-01-01" },
    republic_day: { startDate: "2024-01-26" },
    independence_day: { startDate: "2024-08-15" },
    wedding: { startDate: "2024-11-01", endDate: "2025-02-28", status: "business_estimate", sourceNote: "Editable Kolkata business planning estimate" },
  },
  2025: {
    saraswati_puja: { startDate: "2025-02-02" },
    holi: { startDate: "2025-03-14", endDate: "2025-03-15" },
    poila_boishakh: { startDate: "2025-04-15" },
    rath_yatra: { startDate: "2025-06-27" },
    janmashtami: { startDate: "2025-08-16" },
    vishwakarma_puja: { startDate: "2025-09-17" },
    durga_puja: { startDate: "2025-09-28", endDate: "2025-10-02" },
    lakshmi_puja: { startDate: "2025-10-06" },
    kali_puja: { startDate: "2025-10-20" },
    bhai_phota: { startDate: "2025-10-23" },
    christmas: { startDate: "2025-12-25" },
    new_year: { startDate: "2025-01-01" },
    republic_day: { startDate: "2025-01-26" },
    independence_day: { startDate: "2025-08-15" },
    wedding: { startDate: "2025-11-01", endDate: "2026-02-28", status: "business_estimate", sourceNote: "Editable Kolkata business planning estimate" },
  },
  2026: {
    saraswati_puja: { startDate: "2026-01-23" },
    holi: { startDate: "2026-03-03", endDate: "2026-03-04" },
    poila_boishakh: { startDate: "2026-04-15" },
    rath_yatra: { startDate: "2026-07-16" },
    janmashtami: { startDate: "2026-09-04" },
    vishwakarma_puja: { startDate: "2026-09-17" },
    durga_puja: { startDate: "2026-10-17", endDate: "2026-10-21" },
    lakshmi_puja: { startDate: "2026-10-25" },
    kali_puja: { startDate: "2026-11-08" },
    bhai_phota: { startDate: "2026-11-11" },
    christmas: { startDate: "2026-12-25" },
    new_year: { startDate: "2026-01-01" },
    republic_day: { startDate: "2026-01-26" },
    independence_day: { startDate: "2026-08-15" },
    wedding: { startDate: "2026-11-01", endDate: "2027-02-28", status: "business_estimate", sourceNote: "Editable Kolkata business planning estimate" },
  },
  2027: {
    saraswati_puja: { startDate: "2027-02-11", status: "provisional" },
    holi: { startDate: "2027-03-22", status: "provisional" },
    poila_boishakh: { startDate: "2027-04-15", status: "provisional" },
    rath_yatra: { startDate: "2027-07-05", status: "provisional" },
    janmashtami: { startDate: "2027-08-25", status: "provisional" },
    vishwakarma_puja: { startDate: "2027-09-17", status: "provisional" },
    durga_puja: { startDate: "2027-10-06", endDate: "2027-10-10", status: "provisional" },
    lakshmi_puja: { startDate: "2027-10-14", status: "provisional" },
    kali_puja: { startDate: "2027-10-28", endDate: "2027-10-29", status: "provisional" },
    bhai_phota: { startDate: "2027-10-31", status: "provisional" },
    christmas: { startDate: "2027-12-25", status: "verified" },
    new_year: { startDate: "2027-01-01", status: "verified" },
    republic_day: { startDate: "2027-01-26", status: "verified" },
    independence_day: { startDate: "2027-08-15", status: "verified" },
    wedding: { startDate: "2027-11-01", endDate: "2028-02-29", status: "business_estimate", sourceNote: "Editable Kolkata business planning estimate" },
  },
};

const DEFAULT_SOURCE_NOTE = "Editable Kolkata festival-calendar seed";
const LEGACY_ROLLOVER_SOURCE_NOTE = "Provisional rollover; review this lunar/regional date before planning";

function parseDate(value: string) {
  if (!isValidLocalDate(value)) throw new Error("Choose a valid festival date.");
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateString(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function shiftDate(value: string, days: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateString(date);
}

export function daysBetweenDates(from: string, to: string) {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export function planningWindowStart(entry: Pick<FestivalEntry, "startDate" | "leadTimeWeeks">) {
  return shiftDate(entry.startDate, -Math.round(entry.leadTimeWeeks * 7));
}

export type FestivalCalendarPhase = "planning" | "festival";

export type FestivalCalendarDay = {
  date: string;
  day: number;
  inMonth: boolean;
};

/** Six complete Sunday-first weeks keep the visual month grid stable on every device. */
export function festivalCalendarMonthDays(year: number, month: number): FestivalCalendarDay[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 0 || month > 11)
    throw new Error("Choose a valid calendar month.");
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: dateString(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    };
  });
}

export function festivalCalendarActivities(
  entries: FestivalEntry[],
  date: string,
) {
  if (!isValidLocalDate(date)) throw new Error("Choose a valid calendar date.");
  return entries
    .filter((entry) => planningWindowStart(entry) <= date && entry.endDate >= date)
    .map((entry) => ({
      entry,
      phase: (date < entry.startDate ? "planning" : "festival") as FestivalCalendarPhase,
    }))
    .sort((left, right) =>
      Number(left.phase === "planning") - Number(right.phase === "planning") ||
      left.entry.startDate.localeCompare(right.entry.startDate) ||
      left.entry.festivalKey.localeCompare(right.entry.festivalKey),
    );
}

export function festivalEntryName(entry: Pick<FestivalEntry, "nameEn" | "nameHi" | "nameBn">, language: Language) {
  return language === "hi" ? entry.nameHi : language === "bn" ? entry.nameBn : entry.nameEn;
}

function nearestSeed(year: number, key: FestivalKey): DateSeed {
  const candidates = Object.entries(FESTIVAL_DATE_SEEDS)
    .map(([seedYear, rows]) => ({ year: Number(seedYear), seed: rows[key] }))
    .filter((entry): entry is { year: number; seed: DateSeed } => Boolean(entry.seed))
    .sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year));
  const selected = candidates[0];
  if (!selected) throw new Error(`No calendar seed exists for ${key}.`);
  const move = (value: string) => {
    const targetYear = Number(value.slice(0, 4)) + (year - selected.year);
    const monthDay = value.slice(4);
    const candidate = `${targetYear}${monthDay}`;
    if (isValidLocalDate(candidate)) return candidate;
    return `${targetYear}-02-28`;
  };
  return {
    startDate: move(selected.seed.startDate),
    endDate: selected.seed.endDate ? move(selected.seed.endDate) : undefined,
    status: "provisional",
    sourceNote: "Provisional rollover; review this lunar/regional date before planning",
  };
}

export function festivalEntryId(key: FestivalKey, year: number) {
  return `${key}:${year}`;
}

export function createFestivalEntry(key: FestivalKey, year: number, timestamp = nowIso()): FestivalEntry {
  const definition = definitionByKey.get(key);
  if (!definition) throw new Error("Unknown festival.");
  const seed = FESTIVAL_DATE_SEEDS[year]?.[key] || nearestSeed(year, key);
  return {
    id: festivalEntryId(key, year),
    festivalKey: key,
    year,
    nameEn: definition.nameEn,
    nameHi: definition.nameHi,
    nameBn: definition.nameBn,
    startDate: seed.startDate,
    endDate: seed.endDate || seed.startDate,
    leadTimeWeeks: definition.defaultLeadTimeWeeks,
    dateStatus: seed.status || (year <= 2026 ? "verified" : "provisional"),
    sourceNote: seed.sourceNote || (year === 2026
      ? "West Bengal 2026 holiday-calendar seed; editable for shop planning"
      : year === 2027
        ? "2027 provisional seed; verify when the official West Bengal calendar is published"
        : DEFAULT_SOURCE_NOTE),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function ensureFestivalYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("Choose a valid calendar year.");
  return db.transaction("rw", db.festivalEntries, async () => {
    const ids = FESTIVAL_KEYS.map((key) => festivalEntryId(key, year));
    const existing = await db.festivalEntries.bulkGet(ids);
    const timestamp = nowIso();
    const missing = FESTIVAL_KEYS
      .filter((_, index) => !existing[index])
      .map((key) => createFestivalEntry(key, year, timestamp));
    if (missing.length) await db.festivalEntries.bulkAdd(missing);

    // An early Phase 3 preview generated 2024 by shifting 2025 month/day values,
    // and shipped two superseded 2025 lunar dates. Repair only untouched
    // auto-seeded rows; owner-edited rows carry a distinct source note and are
    // always preserved.
    if (year === 2024 || year === 2025) {
      const repairs = existing.flatMap((row, index) => {
        if (!row || (row.sourceNote !== LEGACY_ROLLOVER_SOURCE_NOTE && row.sourceNote !== DEFAULT_SOURCE_NOTE)) return [];
        const expected = createFestivalEntry(FESTIVAL_KEYS[index], year, row.createdAt);
        if (
          row.startDate === expected.startDate &&
          row.endDate === expected.endDate &&
          row.dateStatus === expected.dateStatus &&
          row.sourceNote === expected.sourceNote
        ) return [];
        return [{
          ...row,
          startDate: expected.startDate,
          endDate: expected.endDate,
          dateStatus: expected.dateStatus,
          sourceNote: expected.sourceNote,
          updatedAt: timestamp,
        }];
      });
      if (repairs.length) await db.festivalEntries.bulkPut(repairs);
    }
    return db.festivalEntries.where("year").equals(year).sortBy("startDate");
  });
}

/** Seed two prior seasons for comparison plus the current and next year. */
export async function ensureFestivalCalendar(today = localDate()) {
  const year = Number(today.slice(0, 4));
  await ensureFestivalYear(year - 2);
  await ensureFestivalYear(year - 1);
  await ensureFestivalYear(year);
  await ensureFestivalYear(year + 1);
  await normalizeMergedFestivalTags();
}

export async function saveFestivalEntry(entry: FestivalEntry) {
  if (!definitionByKey.has(entry.festivalKey as FestivalKey)) throw new Error("Unknown festival.");
  if (!Number.isInteger(entry.year) || entry.id !== festivalEntryId(entry.festivalKey as FestivalKey, entry.year)) {
    throw new Error("Festival year does not match its calendar record.");
  }
  if (!entry.nameEn.trim() || !entry.nameHi.trim() || !entry.nameBn.trim()) throw new Error("Enter all three festival names.");
  parseDate(entry.startDate);
  parseDate(entry.endDate);
  if (Number(entry.startDate.slice(0, 4)) !== entry.year) throw new Error("Festival start date must stay in its calendar year.");
  const endYear = Number(entry.endDate.slice(0, 4));
  const validEndYear = endYear === entry.year || (entry.festivalKey === "wedding" && endYear === entry.year + 1);
  if (!validEndYear) throw new Error("Festival end date does not match its calendar year.");
  if (entry.endDate < entry.startDate) throw new Error("Festival end date cannot be before its start date.");
  if (!Number.isFinite(entry.leadTimeWeeks) || entry.leadTimeWeeks < 0 || entry.leadTimeWeeks > 52) {
    throw new Error("Lead time must be between 0 and 52 weeks.");
  }
  const next: FestivalEntry = {
    ...entry,
    nameEn: entry.nameEn.trim(),
    nameHi: entry.nameHi.trim(),
    nameBn: entry.nameBn.trim(),
    leadTimeWeeks: Math.round(entry.leadTimeWeeks * 10) / 10,
    updatedAt: nowIso(),
  };
  await db.festivalEntries.put(next);
  return next;
}

function aliasesFor(key: FestivalKey) {
  const definition = definitionByKey.get(key);
  return new Set([key, ...(definition?.aliases || [])]);
}

const managedFestivalTags = new Set(FESTIVAL_DEFINITIONS.flatMap((entry) => [entry.key, ...(entry.aliases || [])]));

export function itemHasFestivalTag(item: Pick<Item, "festivalTags">, key: FestivalKey) {
  const aliases = aliasesFor(key);
  return item.festivalTags.some((tag) => aliases.has(tag));
}

export function festivalKeysForItem(item: Pick<Item, "festivalTags">) {
  return FESTIVAL_KEYS.filter((key) => itemHasFestivalTag(item, key));
}

function activeCanonicalItemId(sourceId: string, itemById: Map<string, Item>) {
  const seen = new Set<string>();
  let current = itemById.get(sourceId);
  while (current && !current.isActive && !seen.has(current.id)) {
    seen.add(current.id);
    const nextId = current.festivalTags.find((tag) => tag.startsWith("aliasOf:"))?.slice("aliasOf:".length).trim();
    if (!nextId) break;
    current = itemById.get(nextId);
  }
  return current?.isActive ? current.id : sourceId;
}

function festivalTaggedActiveItems(items: Item[], key: FestivalKey) {
  return items.filter((item) => item.isActive && itemHasFestivalTag(item, key));
}

export function transferMergedFestivalTags(sourceTags: string[], targetTags: string[]) {
  const transferred = sourceTags.filter((tag) => managedFestivalTags.has(tag));
  return {
    sourceTags: sourceTags.filter((tag) => !managedFestivalTags.has(tag)),
    targetTags: [...new Set([...targetTags, ...transferred])],
  };
}

/** Move legacy merged-source festival membership onto its editable active target. */
export async function normalizeMergedFestivalTags() {
  await db.transaction("rw", db.items, async () => {
    const rows = await db.items.toArray();
    const byId = new Map(rows.map((item) => [item.id, { ...item, festivalTags: [...item.festivalTags] }]));
    const changed = new Map<string, Item>();
    const stamp = nowIso();
    for (const source of byId.values()) {
      if (source.isActive || !source.festivalTags.some((tag) => tag.startsWith("aliasOf:"))) continue;
      const targetId = activeCanonicalItemId(source.id, byId);
      const target = byId.get(targetId);
      if (!target?.isActive) continue;
      const transferred = transferMergedFestivalTags(source.festivalTags, target.festivalTags);
      if (transferred.sourceTags.join("\u0000") !== source.festivalTags.join("\u0000")) {
        source.festivalTags = transferred.sourceTags;
        source.updatedAt = stamp;
        source.isSynced = false;
        changed.set(source.id, source);
      }
      if (transferred.targetTags.join("\u0000") !== target.festivalTags.join("\u0000")) {
        target.festivalTags = transferred.targetTags;
        target.updatedAt = stamp;
        target.isSynced = false;
        changed.set(target.id, target);
      }
    }
    if (changed.size) await db.items.bulkPut([...changed.values()]);
  });
}

/** Preserve variant-family, merge-alias and future/unmanaged tags verbatim. */
export function withFestivalKeys(existing: string[], selected: Iterable<FestivalKey>) {
  const preserved = existing.filter((tag) => !managedFestivalTags.has(tag));
  const normalized = [...new Set(selected)].filter((key) => definitionByKey.has(key));
  const represented = normalized.flatMap((key) => {
    const aliases = aliasesFor(key);
    const existingRepresentations = existing.filter((tag) => aliases.has(tag));
    return existingRepresentations.length ? existingRepresentations : [key];
  });
  return [...new Set([...preserved, ...represented])];
}

export async function setItemsFestivalTag(itemIds: string[], key: FestivalKey, enabled: boolean) {
  if (!definitionByKey.has(key)) throw new Error("Choose a valid festival.");
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one product.");
  const stamp = nowIso();
  await db.transaction("rw", db.items, async () => {
    const items = await db.items.bulkGet(ids);
    for (const item of items) {
      if (!item || !item.isActive) continue;
      const selected = new Set(festivalKeysForItem(item));
      if (enabled) selected.add(key);
      else selected.delete(key);
      await db.items.update(item.id, {
        festivalTags: withFestivalKeys(item.festivalTags, selected),
        updatedAt: stamp,
        isSynced: false,
      });
    }
  });
}

export type FestivalTiming = "planning" | "upcoming" | "in_season" | "passed";

export function festivalTiming(entry: FestivalEntry, today: string): FestivalTiming {
  const planningStart = planningWindowStart(entry);
  if (today > entry.endDate) return "passed";
  if (today >= entry.startDate) return "in_season";
  if (today >= planningStart) return "planning";
  return "upcoming";
}

export function relevantFestivalEntries(entries: FestivalEntry[], today: string) {
  const candidates = entries.filter((entry) => entry.endDate >= today);
  return candidates.sort((left, right) => {
    const leftActive = planningWindowStart(left) <= today ? 0 : 1;
    const rightActive = planningWindowStart(right) <= today ? 0 : 1;
    return leftActive - rightActive || left.startDate.localeCompare(right.startDate) || left.nameEn.localeCompare(right.nameEn);
  });
}

export function choosePrimaryFestival(entries: FestivalEntry[], today: string) {
  const relevant = relevantFestivalEntries(entries, today);
  const active = relevant.filter((entry) => planningWindowStart(entry) <= today);
  const futureStart = active.filter((entry) => entry.startDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return futureStart[0] || active.sort((a, b) => a.endDate.localeCompare(b.endDate))[0] || relevant[0];
}

type ItemSeasonRow = {
  itemId: string;
  itemName: string;
  categoryId: string;
  quantity: number;
  revenue: number;
};

export interface FestivalSeasonTotals {
  festivalId: string;
  year: number;
  fromDate: string;
  toDate: string;
  hasInvoiceCoverage: boolean;
  hasSalesActivity: boolean;
  invoiceCount: number;
  revenue: number;
  items: ItemSeasonRow[];
  categories: Array<{ categoryId: string; categoryName: string; revenue: number }>;
  partial: boolean;
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildFestivalSeasonTotals(
  entry: FestivalEntry,
  items: Item[],
  categories: Category[],
  invoices: Invoice[],
  throughDate?: string,
): FestivalSeasonTotals {
  const fromDate = planningWindowStart(entry);
  const requestedEnd = throughDate && throughDate < entry.endDate ? throughDate : entry.endDate;
  const toDate = requestedEnd < fromDate ? fromDate : requestedEnd;
  const allItemsById = new Map(items.map((item) => [item.id, item]));
  const canonicalId = (sourceId: string) => activeCanonicalItemId(sourceId, allItemsById);
  const tagged = festivalTaggedActiveItems(items, entry.festivalKey as FestivalKey);
  const itemById = new Map(tagged.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const sourceSales = new Map(
    invoices
      .filter((invoice) => !invoice.deletedAt && invoice.type === "sale")
      .map((invoice) => [invoice.id, invoice]),
  );
  const eligible = invoices.filter((invoice) =>
    !invoice.deletedAt &&
    (invoice.type === "sale" || invoice.type === "sale_return") &&
    (() => {
      if (invoice.type !== "sale_return") {
        return invoice.date >= fromDate && invoice.date <= toDate;
      }
      const sourceId = invoice.returnDetails?.sourceInvoiceId;
      if (!sourceId) return false;
      const source = sourceSales.get(sourceId);
      return Boolean(source && source.date >= fromDate && source.date <= toDate);
    })(),
  );
  const allSaleDates = invoices
    .filter((invoice) => !invoice.deletedAt && invoice.type === "sale")
    .map((invoice) => invoice.date)
    .sort();
  const hasInvoiceCoverage = Boolean(
    allSaleDates.length &&
    allSaleDates[0] <= fromDate &&
    allSaleDates[allSaleDates.length - 1] >= toDate,
  );
  const hasSalesActivity = eligible.some((invoice) => invoice.type === "sale");
  const byItem = new Map<string, ItemSeasonRow>();
  for (const invoice of eligible) {
    const sign = invoice.type === "sale_return" ? -1 : 1;
    for (const line of invoice.lineItems) {
      const item = itemById.get(canonicalId(line.itemId));
      if (!item) continue;
      let quantity: number;
      try {
        quantity = convertQuantity(line.qty, line.unit, item.baseUnit);
      } catch {
        if (line.unit !== item.baseUnit) continue;
        quantity = line.qty;
      }
      const row = byItem.get(item.id) || {
        itemId: item.id,
        itemName: item.name,
        categoryId: item.categoryId,
        quantity: 0,
        revenue: 0,
      };
      row.quantity = roundQuantity(row.quantity + sign * quantity);
      row.revenue = roundMoney(row.revenue + sign * line.amount);
      byItem.set(item.id, row);
    }
  }
  const categoryRows = new Map<string, { categoryId: string; categoryName: string; revenue: number }>();
  for (const row of byItem.values()) {
    const category = categoryById.get(row.categoryId);
    const aggregate = categoryRows.get(row.categoryId) || {
      categoryId: row.categoryId,
      categoryName: category?.name || "Uncategorized",
      revenue: 0,
    };
    aggregate.revenue = roundMoney(aggregate.revenue + row.revenue);
    categoryRows.set(row.categoryId, aggregate);
  }
  const rows = [...byItem.values()].sort((a, b) => b.revenue - a.revenue || a.itemName.localeCompare(b.itemName));
  return {
    festivalId: entry.id,
    year: entry.year,
    fromDate,
    toDate,
    hasInvoiceCoverage,
    hasSalesActivity,
    invoiceCount: eligible.filter((invoice) => invoice.type === "sale").length,
    revenue: roundMoney(rows.reduce((sum, row) => sum + row.revenue, 0)),
    items: rows,
    categories: [...categoryRows.values()].sort((a, b) => b.revenue - a.revenue || a.categoryName.localeCompare(b.categoryName)),
    partial: toDate < entry.endDate,
  };
}

export interface FestivalProductPlan {
  item: Item;
  lastSeasonQuantity: number | null;
  currentSeasonQuantity: number | null;
  reorderSuggestion: number | null;
  reorderState: "ready" | "no_history" | "unknown_stock" | "reconcile_stock";
}

export interface FestivalComparison {
  current: FestivalSeasonTotals;
  previous: FestivalSeasonTotals;
  itemRows: Array<{
    itemId: string;
    itemName: string;
    currentQuantity: number;
    previousQuantity: number;
    currentRevenue: number;
    previousRevenue: number;
  }>;
  categoryRows: Array<{
    categoryId: string;
    categoryName: string;
    currentRevenue: number;
    previousRevenue: number;
  }>;
}

export function buildFestivalComparison(current: FestivalSeasonTotals, previous: FestivalSeasonTotals): FestivalComparison {
  const currentItems = new Map(current.items.map((row) => [row.itemId, row]));
  const previousItems = new Map(previous.items.map((row) => [row.itemId, row]));
  const itemIds = new Set([...currentItems.keys(), ...previousItems.keys()]);
  const currentCategories = new Map(current.categories.map((row) => [row.categoryId, row]));
  const previousCategories = new Map(previous.categories.map((row) => [row.categoryId, row]));
  const categoryIds = new Set([...currentCategories.keys(), ...previousCategories.keys()]);
  return {
    current,
    previous,
    itemRows: [...itemIds].map((itemId) => {
      const now = currentItems.get(itemId);
      const before = previousItems.get(itemId);
      return {
        itemId,
        itemName: now?.itemName || before?.itemName || itemId,
        currentQuantity: now?.quantity || 0,
        previousQuantity: before?.quantity || 0,
        currentRevenue: now?.revenue || 0,
        previousRevenue: before?.revenue || 0,
      };
    }).sort((a, b) => b.currentRevenue - a.currentRevenue || a.itemName.localeCompare(b.itemName)),
    categoryRows: [...categoryIds].map((categoryId) => {
      const now = currentCategories.get(categoryId);
      const before = previousCategories.get(categoryId);
      return {
        categoryId,
        categoryName: now?.categoryName || before?.categoryName || categoryId,
        currentRevenue: now?.revenue || 0,
        previousRevenue: before?.revenue || 0,
      };
    }).sort((a, b) => b.currentRevenue - a.currentRevenue || a.categoryName.localeCompare(b.categoryName)),
  };
}

export function buildFestivalPlan(
  selected: FestivalEntry,
  allEntries: FestivalEntry[],
  items: Item[],
  categories: Category[],
  invoices: Invoice[],
  today: string,
) {
  const prior = allEntries
    .filter((entry) => entry.festivalKey === selected.festivalKey && entry.endDate < selected.startDate)
    .map((entry) => ({ entry, totals: buildFestivalSeasonTotals(entry, items, categories, invoices) }))
    .filter((row) => row.totals.hasInvoiceCoverage)
    .sort((a, b) => a.entry.startDate.localeCompare(b.entry.startDate));
  const last = prior.at(-1)?.totals;
  const currentThrough = today >= planningWindowStart(selected) && today < selected.endDate ? today : undefined;
  const current = buildFestivalSeasonTotals(selected, items, categories, invoices, currentThrough);
  const tagged = festivalTaggedActiveItems(items, selected.festivalKey as FestivalKey)
    .sort((a, b) => a.name.localeCompare(b.name));
  const lastByItem = new Map(last?.items.map((row) => [row.itemId, row.quantity]) || []);
  const currentByItem = new Map(current.items.map((row) => [row.itemId, row.quantity]));
  const products: FestivalProductPlan[] = tagged.map((item) => {
    const lastSeasonQuantity = last ? (lastByItem.get(item.id) || 0) : null;
    const currentSeasonQuantity = current.hasSalesActivity ? (currentByItem.get(item.id) || 0) : null;
    const reorderState = !last
      ? "no_history" as const
      : item.currentStock === null
        ? "unknown_stock" as const
        : item.currentStock < 0
          ? "reconcile_stock" as const
          : "ready" as const;
    return {
      item,
      lastSeasonQuantity,
      currentSeasonQuantity,
      reorderSuggestion: reorderState === "ready" ? Math.max(0, roundQuantity((lastSeasonQuantity || 0) - item.currentStock!)) : null,
      reorderState,
    };
  });
  const comparable = [
    ...prior.map((row) => row.totals),
    ...(current.hasInvoiceCoverage ? [current] : []),
  ];
  const comparison = comparable.length >= 2
    ? buildFestivalComparison(comparable.at(-1)!, comparable.at(-2)!)
    : null;
  return {
    selected,
    current,
    products,
    historyYears: prior.map((row) => row.entry.year),
    lastSeason: last || null,
    comparison,
  };
}

export interface FestivalLeftoverRow {
  festival: FestivalEntry;
  item: Item;
  remainingStock: number;
  threshold: number | null;
  stockValue: number | null;
  missingCost: boolean;
  daysPast: number;
  carryTo?: FestivalEntry;
}

function remainingSeasonStock(item: Item, festival: FestivalEntry, movements: StockMovement[], sourceSales: Map<string, Invoice>) {
  if (item.currentStock === null || item.currentStock <= 0) return null;
  const endOfFestival = Date.parse(`${festival.endDate}T23:59:59.999+05:30`);
  const recordedByFestivalEnd = (movement: StockMovement) => {
    const recordedAt = Date.parse(movement.createdAt);
    return Number.isFinite(recordedAt) && recordedAt <= endOfFestival;
  };
  const applied = movements
    .filter((movement) => movement.itemId === item.id && movement.applied)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const atEnd = applied.filter((movement) => recordedByFestivalEnd(movement) && movement.stockAfter !== null).at(-1);
  if (!atEnd || atEnd.stockAfter === null) return null;
  let remaining = Math.max(0, atEnd.stockAfter);
  const fromDate = planningWindowStart(festival);
  for (const movement of applied) {
    if (recordedByFestivalEnd(movement) || movement.qtyChange === null) continue;
    if (movement.qtyChange < 0) {
      remaining = Math.max(0, roundQuantity(remaining + movement.qtyChange));
      continue;
    }
    const sourceId = movement.sourceInvoiceId || (movement.kind === "sale_void" ? movement.refInvoiceId : undefined);
    const source = sourceId ? sourceSales.get(sourceId) : undefined;
    if (
      source &&
      (movement.kind === "sale_return" || movement.kind === "sale_void") &&
      source.date >= fromDate &&
      source.date <= festival.endDate
    ) remaining = roundQuantity(remaining + movement.qtyChange);
  }
  return Math.min(item.currentStock, remaining);
}

export function buildPostSeasonLeftovers(entries: FestivalEntry[], items: Item[], movements: StockMovement[], invoices: Invoice[], today: string) {
  const latestByKey = new Map<string, FestivalEntry>();
  for (const entry of entries.filter((row) => row.endDate < today)) {
    const previous = latestByKey.get(entry.festivalKey);
    if (!previous || entry.endDate > previous.endDate) latestByKey.set(entry.festivalKey, entry);
  }
  const rows: FestivalLeftoverRow[] = [];
  const sourceSales = new Map(invoices.filter((invoice) => invoice.type === "sale").map((invoice) => [invoice.id, invoice]));
  for (const festival of latestByKey.values()) {
    for (const item of festivalTaggedActiveItems(items, festival.festivalKey as FestivalKey)) {
      const remainingStock = remainingSeasonStock(item, festival, movements, sourceSales);
      if (remainingStock === null) continue;
      const threshold = item.lowStockAlert;
      const significant = threshold === null ? remainingStock > 0 : remainingStock > threshold;
      if (!significant) continue;
      const carryTo = entries
        .filter((entry) =>
          entry.festivalKey !== festival.festivalKey &&
          planningWindowStart(entry) <= today &&
          entry.endDate >= today &&
          itemHasFestivalTag(item, entry.festivalKey as FestivalKey),
        )
        .sort((a, b) => planningWindowStart(a).localeCompare(planningWindowStart(b)) || a.startDate.localeCompare(b.startDate))[0];
      rows.push({
        festival,
        item,
        remainingStock,
        threshold,
        stockValue: item.purchasePrice > 0 ? roundMoney(remainingStock * item.purchasePrice) : null,
        missingCost: item.purchasePrice <= 0,
        daysPast: daysBetweenDates(festival.endDate, today),
        ...(carryTo ? { carryTo } : {}),
      });
    }
  }
  return rows.sort((a, b) => a.daysPast - b.daysPast || b.remainingStock - a.remainingStock || a.item.name.localeCompare(b.item.name));
}

export function festivalTaskId(festivalId: string) {
  return `${festivalId}:stock_plan`;
}

export async function setFestivalTaskCompleted(festivalId: string, completed: boolean) {
  const festival = await db.festivalEntries.get(festivalId);
  if (!festival) throw new Error("This festival is no longer in the calendar.");
  const timestamp = nowIso();
  const task: FestivalTask = {
    id: festivalTaskId(festivalId),
    festivalId,
    kind: "stock_plan",
    ...(completed ? { completedAt: timestamp } : {}),
    updatedAt: timestamp,
  };
  await db.festivalTasks.put(task);
  return task;
}
