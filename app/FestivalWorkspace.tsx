"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  localDate,
  type Category,
  type FestivalEntry,
  type FestivalTask,
  type Invoice,
  type Item,
  type Language,
  type StockMovement,
} from "../lib/db";
import { formatMoney } from "../lib/billing";
import {
  buildFestivalPlan,
  buildPostSeasonLeftovers,
  choosePrimaryFestival,
  daysBetweenDates,
  ensureFestivalYear,
  festivalEntryName,
  festivalCalendarActivities,
  festivalCalendarMonthDays,
  festivalTaskId,
  festivalTiming,
  FESTIVAL_DEFINITIONS,
  itemHasFestivalTag,
  planningWindowStart,
  relevantFestivalEntries,
  saveFestivalEntry,
  setFestivalTaskCompleted,
  setItemsFestivalTag,
  type FestivalKey,
} from "../lib/festivals";
import {
  formatLocalizedDate,
  localeForLanguage,
  localizedCategoryName,
  localizedItemName,
  localizedUnitName,
} from "../lib/i18n";
import { festivalCopy, festivalText } from "./festival-copy";

type FestivalView = "dashboard" | "calendar" | "tagging" | "comparison" | "leftovers";

type Props = {
  items: Item[];
  categories: Category[];
  invoices: Invoice[];
  language: Language;
  ownerMode: boolean;
  onBackCatalogue: () => void;
  onOpenReports: () => void;
  onChanged: (message: string) => void;
};

function useLiveToday() {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = localDate();
      setToday((current) => current === next ? current : next);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

function dateLabel(value: string, language: Language) {
  return formatLocalizedDate(value, language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function rangeLabel(entry: FestivalEntry, language: Language) {
  return entry.startDate === entry.endDate
    ? dateLabel(entry.startDate, language)
    : `${dateLabel(entry.startDate, language)} – ${dateLabel(entry.endDate, language)}`;
}

function FestivalTabs({ view, language, onView }: { view: FestivalView; language: Language; onView: (view: FestivalView) => void }) {
  const copy = festivalCopy(language);
  const tabs: Array<[FestivalView, string]> = [
    ["dashboard", copy.dashboard],
    ["calendar", copy.calendar],
    ["tagging", copy.tagging],
    ["comparison", copy.comparison],
    ["leftovers", copy.leftovers],
  ];
  return (
    <div className="festival-tabs mt-4" role="group" aria-label={copy.title}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => onView(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FestivalEditorCard({ entry, language, onSaved }: { entry: FestivalEntry; language: Language; onSaved: (message: string) => void }) {
  const copy = festivalCopy(language);
  const [draft, setDraft] = useState(entry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const statusLabel = draft.dateStatus === "verified"
    ? copy.verified
    : draft.dateStatus === "provisional"
      ? copy.provisional
      : copy.businessEstimate;
  const sourceLabel = draft.dateStatus === "verified"
    ? copy.verifiedSource
    : draft.dateStatus === "provisional"
      ? copy.provisionalSource
      : copy.businessEstimateSource;

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const dateChanged = draft.startDate !== entry.startDate || draft.endDate !== entry.endDate;
      const saved = await saveFestivalEntry({
        ...draft,
        ...(dateChanged ? {
          dateStatus: "business_estimate" as const,
          sourceNote: "Owner-edited date stored on this device",
        } : {}),
      });
      setDraft(saved);
      onSaved(copy.saved);
    } catch (cause) {
      setError(language === "en" && cause instanceof Error ? cause.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="festival-calendar-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3>{festivalEntryName(draft, language)}</h3>
          <p>{rangeLabel(draft, language)}</p>
        </div>
        <span data-status={draft.dateStatus}>{statusLabel}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="product-field">
          <span>{copy.startDate}</span>
          <input type="date" value={draft.startDate} min={`${draft.year}-01-01`} max={`${draft.year}-12-31`} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
        </label>
        <label className="product-field">
          <span>{copy.endDate}</span>
          <input type="date" value={draft.endDate} min={draft.startDate} max={`${draft.festivalKey === "wedding" ? draft.year + 1 : draft.year}-12-31`} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
        </label>
        <label className="product-field">
          <span>{copy.leadTime}</span>
          <input type="number" inputMode="decimal" min="0" max="52" step="1" value={draft.leadTimeWeeks} onChange={(event) => setDraft({ ...draft, leadTimeWeeks: Number(event.target.value) })} />
        </label>
      </div>
      <details className="festival-name-details mt-3">
        <summary>{copy.names}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="product-field"><span>{copy.englishName}</span><input value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} /></label>
          <label className="product-field"><span>{copy.hindiName}</span><input value={draft.nameHi} onChange={(event) => setDraft({ ...draft, nameHi: event.target.value })} /></label>
          <label className="product-field"><span>{copy.bengaliName}</span><input value={draft.nameBn} onChange={(event) => setDraft({ ...draft, nameBn: event.target.value })} /></label>
        </div>
      </details>
      <p className="festival-source-note mt-3">{sourceLabel}</p>
      {error && <p role="alert" className="festival-error mt-3">{error}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className="counter-primary mt-3 w-full sm:w-auto">
        {saving ? festivalText(language, "Saving…", "सेव हो रहा है…", "সেভ হচ্ছে…") : copy.saveDate}
      </button>
    </article>
  );
}

function DashboardView({
  entries,
  tasks,
  items,
  categories,
  invoices,
  language,
  today,
  selectedId,
  onSelected,
  onView,
  onChanged,
}: {
  entries: FestivalEntry[];
  tasks: FestivalTask[];
  items: Item[];
  categories: Category[];
  invoices: Invoice[];
  language: Language;
  today: string;
  selectedId: string;
  onSelected: (id: string) => void;
  onView: (view: FestivalView) => void;
  onChanged: (message: string) => void;
}) {
  const copy = festivalCopy(language);
  const primary = choosePrimaryFestival(entries, today);
  const selected = entries.find((entry) => entry.id === selectedId) || primary;
  const plan = selected ? buildFestivalPlan(selected, entries, items, categories, invoices, today) : null;
  const [planLimit, setPlanLimit] = useState(200);
  const selectFestival = (id: string) => {
    setPlanLimit(200);
    onSelected(id);
  };
  const relevant = relevantFestivalEntries(entries, today);
  const active = relevant.filter((entry) => planningWindowStart(entry) <= today);
  const taskEntries = [...active, ...relevant.filter((entry) => !active.some((activeEntry) => activeEntry.id === entry.id)).slice(0, 3)];
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  if (!selected || !plan) return <p className="settings-card mt-4">{copy.noHistoryDetail}</p>;
  const timing = festivalTiming(selected, today);
  const daysToStart = daysBetweenDates(today, selected.startDate);
  const daysToEnd = Math.max(0, daysBetweenDates(today, selected.endDate));
  const daysToPlanning = daysBetweenDates(today, planningWindowStart(selected));
  const countdown = timing === "in_season"
    ? copy.endsIn(daysToEnd)
    : timing === "planning"
      ? copy.startsIn(Math.max(0, daysToStart))
      : copy.planningStartsIn(Math.max(0, daysToPlanning));

  return (
    <div className="mt-4 space-y-4">
      <section className="festival-hero">
        <div className="min-w-0">
          <p>{timing === "in_season" ? copy.activeSeason : timing === "planning" ? copy.planningNow : copy.nextFestival}</p>
          <h3>{festivalEntryName(selected, language)}</h3>
          <strong>{countdown}</strong>
          <div className="festival-hero-dates">
            <span>{copy.dateRange}: {rangeLabel(selected, language)}</span>
            <span>{copy.salesWindow}: {dateLabel(planningWindowStart(selected), language)} – {dateLabel(selected.endDate, language)}</span>
          </div>
        </div>
        <div className="grid gap-2 self-stretch sm:w-56">
          <button type="button" onClick={() => onView("calendar")} className="festival-hero-action">{copy.calendar}</button>
          <button type="button" onClick={() => onView("tagging")} className="festival-hero-action">{copy.tagging}</button>
        </div>
      </section>

      <section className="festival-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3>{copy.overlapping}</h3>
            <p>{copy.overlappingHelp}</p>
          </div>
          <strong className="festival-count-badge">{active.length}</strong>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((entry) => (
            <button key={entry.id} type="button" onClick={() => selectFestival(entry.id)} className="festival-season-lane">
              <span>{festivalEntryName(entry, language)}</span>
              <small>{dateLabel(planningWindowStart(entry), language)} → {dateLabel(entry.endDate, language)}</small>
            </button>
          ))}
          {!active.length && <p className="festival-empty">{copy.nextFestival}: {festivalEntryName(primary, language)}</p>}
        </div>
      </section>

      <section className="festival-panel">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3>{copy.tasks}</h3><p>{copy.allOffline}</p></div>
        </div>
        <div className="mt-3 grid gap-2">
          {taskEntries.map((entry) => {
            const task = taskById.get(festivalTaskId(entry.id));
            const completed = Boolean(task?.completedAt);
            const dueDate = planningWindowStart(entry);
            return (
              <label key={entry.id} className={`festival-task-row ${completed ? "done" : ""}`}>
                <input
                  type="checkbox"
                  checked={completed}
                  onChange={async (event) => {
                    try {
                      await setFestivalTaskCompleted(entry.id, event.target.checked);
                      onChanged(event.target.checked ? copy.done : copy.markDone);
                    } catch {
                      onChanged(copy.saveFailed);
                    }
                  }}
                />
                <span><strong>{copy.orderStock(festivalEntryName(entry, language))}</strong><small>{copy.due}: {dateLabel(dueDate, language)}</small></span>
                <b>{completed ? copy.done : festivalTiming(entry, today) === "upcoming" ? copy.startsIn(Math.max(0, daysBetweenDates(today, entry.startDate))) : copy.planningNow}</b>
              </label>
            );
          })}
        </div>
      </section>

      <section className="festival-panel">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3>{copy.reorderPlan}</h3><p>{copy.reorderHelp}</p></div>
          <label className="product-field w-full max-w-full sm:w-56">
            <span>{copy.chooseFestival}</span>
            <select value={selected.id} onChange={(event) => selectFestival(event.target.value)}>
              {relevant.slice(0, 24).map((entry) => <option key={entry.id} value={entry.id}>{festivalEntryName(entry, language)} · {entry.year}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 rounded-xl bg-[#f4faf0] p-3 text-xs font-bold text-[#315c49]">
          {!plan.historyYears.length
            ? <><strong>{copy.noHistory}</strong><span className="ml-2">{copy.noHistoryDetail}</span></>
            : plan.historyYears.length === 1
              ? copy.oneYear(plan.historyYears[0])
              : copy.historyYears(plan.historyYears.join(", "))}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {plan.products.slice(0, planLimit).map((row) => (
            <article key={row.item.id} className="festival-plan-card">
              <div className="min-w-0"><h4>{localizedItemName(language, row.item)}</h4><p>{row.item.skuCode} · {localizedUnitName(language, row.item.baseUnit)}</p></div>
              <dl>
                <div><dt>{copy.lastSeason}</dt><dd>{row.lastSeasonQuantity == null ? "—" : row.lastSeasonQuantity}</dd></div>
                <div><dt>{copy.currentStock}</dt><dd>{row.item.currentStock == null ? "—" : row.item.currentStock}</dd></div>
                <div><dt>{copy.suggestedOrder}</dt><dd>{row.reorderState === "ready" ? row.reorderSuggestion : row.reorderState === "no_history" ? copy.noHistory : copy.unknownStock}</dd></div>
              </dl>
            </article>
          ))}
          {!plan.products.length && <p className="festival-empty">{copy.noProducts}</p>}
        </div>
        {plan.products.length > planLimit && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"><p className="festival-source-note">{copy.showingFirst(planLimit, plan.products.length)}</p><button type="button" onClick={() => setPlanLimit((count) => Math.min(plan.products.length, count + 200))} className="counter-secondary">{copy.showMoreProducts(Math.min(200, plan.products.length - planLimit))}</button></div>}
      </section>
    </div>
  );
}

function festivalTone(entry: FestivalEntry) {
  const index = FESTIVAL_DEFINITIONS.findIndex((definition) => definition.key === entry.festivalKey);
  return Math.max(0, index) % 8;
}

function CalendarView({ entries, language, onChanged }: { entries: FestivalEntry[]; language: Language; onChanged: (message: string) => void }) {
  const copy = festivalCopy(language);
  const today = localDate();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7)) - 1;
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [showAllEditors, setShowAllEditors] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const navigationTokenRef = useRef(0);
  const triggerDateRef = useRef("");
  const locale = localeForLanguage(language);
  const years = [...new Set([currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2, year])].sort((left, right) => left - right);
  const rows = entries.filter((entry) => entry.year === year).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const monthDays = useMemo(() => festivalCalendarMonthDays(year, month), [year, month]);
  const activitiesByDate = useMemo(
    () => new Map(monthDays.map((day) => [day.date, festivalCalendarActivities(entries, day.date)])),
    [entries, monthDays],
  );
  const selectedActivities = selectedDate ? festivalCalendarActivities(entries, selectedDate) : [];
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
    [locale],
  );
  const shortMonthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }),
    [locale],
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }),
    [locale],
  );
  const monthLabel = monthFormatter.format(new Date(Date.UTC(year, month, 1)));
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    weekdayFormatter.format(new Date(Date.UTC(2026, 7, 2 + index))),
  );
  const monthSummaries = Array.from({ length: 12 }, (_, monthIndex) => {
    const start = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
    const end = monthIndex === 11
      ? `${year}-12-31`
      : new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
    const activeEntries = entries.filter((entry) => planningWindowStart(entry) <= end && entry.endDate >= start);
    return { month: monthIndex, entries: activeEntries };
  });

  const closeDateDetails = useCallback(() => {
    const triggerDate = triggerDateRef.current;
    setSelectedDate("");
    setSelectedEntryId("");
    setEditingId("");
    if (triggerDate) {
      window.requestAnimationFrame(() => document.getElementById(`festival-day-${triggerDate}`)?.focus());
    }
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    const frame = window.requestAnimationFrame(() => {
      const detail = detailRef.current;
      detail?.focus({ preventScroll: true });
      detail?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeDateDetails();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeDateDetails, selectedDate]);

  async function chooseYear(next: number, nextMonth = month) {
    const token = ++navigationTokenRef.current;
    setCalendarBusy(true);
    try {
      await ensureFestivalYear(next - 1);
      await ensureFestivalYear(next);
      await ensureFestivalYear(next + 1);
      if (navigationTokenRef.current !== token) return false;
      setYear(next);
      setMonth(nextMonth);
      setSelectedDate("");
      setSelectedEntryId("");
      setEditingId("");
      return true;
    } catch {
      if (navigationTokenRef.current === token) onChanged(copy.saveFailed);
      return false;
    } finally {
      if (navigationTokenRef.current === token) setCalendarBusy(false);
    }
  }

  function moveMonth(delta: number) {
    const nextDate = new Date(Date.UTC(year, month + delta, 1));
    void chooseYear(nextDate.getUTCFullYear(), nextDate.getUTCMonth());
  }

  function openDate(date: string, entryId = "") {
    triggerDateRef.current = date;
    const nextYear = Number(date.slice(0, 4));
    const nextMonth = Number(date.slice(5, 7)) - 1;
    if (nextYear !== year || nextMonth !== month) {
      void chooseYear(nextYear, nextMonth).then((changed) => {
        if (!changed) return;
        setSelectedDate(date);
        setSelectedEntryId(entryId);
      });
      return;
    }
    setSelectedDate(date);
    setSelectedEntryId(entryId);
    setEditingId("");
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="festival-calendar-overview">
        <div className="festival-calendar-overview__header">
          <div>
            <p className="eyebrow">{copy.calendarSpectrum}</p>
            <h3>{copy.calendar}</h3>
            <p>{copy.calendarHelp}</p>
          </div>
          <label className="product-field w-full max-w-full sm:w-44">
            <span>{copy.chooseYear}</span>
            <select value={year} disabled={calendarBusy} onChange={(event) => void chooseYear(Number(event.target.value))}>
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="festival-year-spectrum" role="group" aria-label={copy.yearSpectrum}>
          {monthSummaries.map((summary) => (
            <button
              key={summary.month}
              type="button"
              disabled={calendarBusy}
              aria-pressed={month === summary.month}
              onClick={() => {
                setMonth(summary.month);
                setSelectedDate("");
                setSelectedEntryId("");
                setEditingId("");
              }}
            >
              <span>{shortMonthFormatter.format(new Date(Date.UTC(year, summary.month, 1)))}</span>
              <strong>{summary.entries.length}</strong>
              <small>{copy.activeWindows}</small>
              <i aria-hidden="true">
                {summary.entries.slice(0, 5).map((entry) => <b key={entry.id} data-tone={festivalTone(entry)} />)}
              </i>
            </button>
          ))}
        </div>
      </section>

      <section className="festival-calendar-shell" aria-label={`${copy.calendar}: ${monthLabel}`} aria-busy={calendarBusy}>
        <div className="festival-calendar-toolbar">
          <button type="button" disabled={calendarBusy} onClick={() => moveMonth(-1)} aria-label={copy.previousMonth}>‹</button>
          <div>
            <p>{copy.monthView}</p>
            <h3>{monthLabel}</h3>
          </div>
          <button type="button" disabled={calendarBusy} onClick={() => moveMonth(1)} aria-label={copy.nextMonth}>›</button>
          <button type="button" disabled={calendarBusy} className="festival-calendar-today" onClick={() => void chooseYear(currentYear, currentMonth)}>{copy.today}</button>
        </div>
        <div className="festival-calendar-legend" aria-label={copy.legend}>
          <span data-phase="planning"><i />{copy.organizingPeriod}</span>
          <span data-phase="festival"><i />{copy.festivalDates}</span>
          <span data-phase="overlap"><i />{copy.overlappingDates}</span>
          <span data-phase="today"><i />{copy.today}</span>
        </div>
        <div className="festival-calendar-scroller">
          <div className="festival-calendar-weekdays" aria-hidden="true">
            {weekdays.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}
          </div>
          <div className="festival-calendar-grid">
            {monthDays.map((day) => {
              const activities = activitiesByDate.get(day.date) || [];
              const isSelected = selectedDate === day.date;
              const isToday = today === day.date;
              return (
                <div
                  key={day.date}
                  className="festival-calendar-day"
                  data-outside={!day.inMonth || undefined}
                  data-selected={isSelected || undefined}
                  data-today={isToday || undefined}
                  data-overlap={activities.length > 1 || undefined}
                >
                  <button
                    id={`festival-day-${day.date}`}
                    type="button"
                    disabled={calendarBusy}
                    className="festival-calendar-day__date"
                    aria-expanded={isSelected}
                    aria-controls="festival-calendar-detail"
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${dateLabel(day.date, language)} · ${activities.length} ${copy.activeWindows}`}
                    onClick={() => openDate(day.date)}
                  >
                    <time dateTime={day.date}>{day.day}</time>
                    {activities.length > 1 && <span>{activities.length}</span>}
                  </button>
                  <div className="festival-calendar-day__events">
                    {activities.slice(0, 3).map(({ entry, phase }) => (
                      <span
                        key={`${day.date}:${entry.id}`}
                        data-phase={phase}
                        data-tone={festivalTone(entry)}
                      >
                        {festivalEntryName(entry, language)}
                      </span>
                    ))}
                    {activities.length > 3 && (
                      <span className="festival-calendar-more">
                        +{activities.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {selectedDate && (
          <section id="festival-calendar-detail" ref={detailRef} tabIndex={-1} role="region" className="festival-calendar-dropdown" aria-labelledby="festival-selected-date" aria-live="polite">
            <header>
              <div>
                <p>{copy.selectedDate}</p>
                <h3 id="festival-selected-date">{dateLabel(selectedDate, language)}</h3>
              </div>
              <button type="button" onClick={closeDateDetails} aria-label={copy.closeDetails}>×</button>
            </header>
            {!selectedActivities.length && <p className="festival-empty">{copy.noCalendarActivity}</p>}
            <div className="festival-calendar-dropdown__list">
              {selectedActivities.map(({ entry, phase }) => {
                const planningStart = planningWindowStart(entry);
                const selected = selectedEntryId === entry.id;
                return (
                  <article key={entry.id} data-tone={festivalTone(entry)} data-selected={selected || undefined}>
                    <div className="festival-calendar-dropdown__title">
                      <span data-phase={phase}>{phase === "planning" ? copy.organizingNow : copy.festivalNow}</span>
                      <h4>{festivalEntryName(entry, language)}</h4>
                      <small>{entry.dateStatus === "verified" ? copy.verified : entry.dateStatus === "provisional" ? copy.provisional : copy.businessEstimate}</small>
                    </div>
                    <dl>
                      <div><dt>{copy.startOrganizing}</dt><dd>{dateLabel(planningStart, language)}</dd></div>
                      <div><dt>{copy.festivalDates}</dt><dd>{rangeLabel(entry, language)}</dd></div>
                      <div><dt>{copy.salesWindow}</dt><dd>{dateLabel(planningStart, language)} → {dateLabel(entry.endDate, language)}</dd></div>
                      <div><dt>{copy.leadTime}</dt><dd>{entry.leadTimeWeeks} {copy.weeks}</dd></div>
                    </dl>
                    <button type="button" className="counter-secondary" onClick={() => { setSelectedEntryId(entry.id); setEditingId((current) => current === entry.id ? "" : entry.id); }}>
                      {editingId === entry.id ? copy.hideEditor : copy.editFestival}
                    </button>
                    {editingId === entry.id && <div className="mt-3"><FestivalEditorCard key={`${entry.id}:${entry.updatedAt}`} entry={entry} language={language} onSaved={onChanged} /></div>}
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>

      <section className="festival-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3>{copy.calendarSettings}</h3><p>{copy.calendarSettingsHelp}</p></div>
          <button type="button" className="counter-secondary" onClick={() => setShowAllEditors((open) => !open)}>
            {showAllEditors ? copy.hideAllDates : copy.editAllDates}
          </button>
        </div>
      </section>
      {showAllEditors && (
        <div className="grid gap-3">
          {rows.map((entry) => <FestivalEditorCard key={`${entry.id}:${entry.updatedAt}`} entry={entry} language={language} onSaved={onChanged} />)}
        </div>
      )}
    </div>
  );
}

function TaggingView({ entries, items, categories, language, onChanged }: { entries: FestivalEntry[]; items: Item[]; categories: Category[]; language: Language; onChanged: (message: string) => void }) {
  const copy = festivalCopy(language);
  const currentYear = Number(localDate().slice(0, 4));
  const yearEntries = entries.filter((entry) => entry.year === currentYear);
  const defaultKey = (yearEntries[0]?.festivalKey || FESTIVAL_DEFINITIONS[0].key) as FestivalKey;
  const [festivalKey, setFestivalKey] = useState<FestivalKey>(defaultKey);
  const [categoryId, setCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [taggedOnly, setTaggedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(120);
  const [busy, setBusy] = useState(false);
  const entryByKey = new Map(yearEntries.map((entry) => [entry.festivalKey, entry]));
  const cleanQuery = query.trim().toLocaleLowerCase();
  const filtered = items.filter((item) =>
    item.isActive &&
    (!categoryId || item.categoryId === categoryId) &&
    (!taggedOnly || itemHasFestivalTag(item, festivalKey)) &&
    (!cleanQuery || [item.name, item.nameHi, item.nameBn, item.skuCode].some((value) => value.toLocaleLowerCase().includes(cleanQuery))),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const visible = filtered.slice(0, visibleCount);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply(enabled: boolean) {
    if (!selected.size || busy) return;
    setBusy(true);
    try {
      const ids = [...selected];
      await setItemsFestivalTag(ids, festivalKey, enabled);
      setSelected(new Set());
      onChanged(copy.tagsSaved(ids.length));
    } catch {
      onChanged(copy.tagsSaveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="festival-panel">
        <div><h3>{copy.tagging}</h3><p>{copy.productFestivalHelp}</p></div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="product-field"><span>{copy.chooseFestival}</span><select value={festivalKey} onChange={(event) => { setFestivalKey(event.target.value as FestivalKey); setSelected(new Set()); setVisibleCount(120); }}>
            {FESTIVAL_DEFINITIONS.map((definition) => {
              const entry = entryByKey.get(definition.key);
              const label = entry ? festivalEntryName(entry, language) : language === "hi" ? definition.nameHi : language === "bn" ? definition.nameBn : definition.nameEn;
              return <option key={definition.key} value={definition.key}>{label}</option>;
            })}
          </select></label>
          <label className="product-field"><span>{copy.filterCategory}</span><select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSelected(new Set()); setVisibleCount(120); }}><option value="">{copy.allCategories}</option>{categories.map((category) => <option key={category.id} value={category.id}>{localizedCategoryName(language, category.name)}</option>)}</select></label>
          <label className="product-field"><span>{copy.searchProducts}</span><input value={query} onChange={(event) => { setQuery(event.target.value); setSelected(new Set()); setVisibleCount(120); }} placeholder={copy.searchProducts} /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" role="switch" aria-checked={taggedOnly} onClick={() => { setTaggedOnly((value) => !value); setSelected(new Set()); setVisibleCount(120); }} className={`festival-filter-toggle ${taggedOnly ? "active" : ""}`}>{copy.showTaggedOnly}</button>
          <button type="button" disabled={!filtered.length || busy} onClick={() => setSelected(new Set(filtered.map((item) => item.id)))} className="counter-secondary disabled:opacity-40">{copy.selectAllFiltered(filtered.length)}</button>
          <button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())} className="counter-secondary disabled:opacity-40">{copy.clearSelection}</button>
          <output aria-live="polite" className="festival-count-badge">{copy.selected(selected.size)}</output>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!selected.size || busy} onClick={() => void apply(true)} className="counter-primary disabled:opacity-40">＋ {copy.addTag}</button>
          <button type="button" disabled={!selected.size || busy} onClick={() => void apply(false)} className="counter-secondary disabled:opacity-40">− {copy.removeTag}</button>
        </div>
      </section>
      <section className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((item) => {
          const tagged = itemHasFestivalTag(item, festivalKey);
          return (
            <label key={item.id} className={`festival-product-select ${selected.has(item.id) ? "selected" : ""}`}>
              <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
              <span className="min-w-0"><strong>{localizedItemName(language, item)}</strong><small>{item.skuCode} · {localizedCategoryName(language, categories.find((category) => category.id === item.categoryId)?.name || "Uncategorized")}</small></span>
              <b>{tagged ? festivalText(language, "Tagged", "टैग किया", "ট্যাগ করা") : "—"}</b>
            </label>
          );
        })}
        {!visible.length && <p className="festival-empty">{copy.noProducts}</p>}
      </section>
      {filtered.length > visible.length && <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"><p className="festival-source-note">{copy.showingFirst(visible.length, filtered.length)}</p><button type="button" onClick={() => setVisibleCount((count) => Math.min(filtered.length, count + 120))} className="counter-secondary">{copy.showMoreProducts(Math.min(120, filtered.length - visible.length))}</button></div>}
    </div>
  );
}

function ComparisonView({ entries, items, categories, invoices, language, today }: { entries: FestivalEntry[]; items: Item[]; categories: Category[]; invoices: Invoice[]; language: Language; today: string }) {
  const copy = festivalCopy(language);
  const primary = choosePrimaryFestival(entries, today);
  const [selectedId, setSelectedId] = useState(primary?.id || "");
  const selected = entries.find((entry) => entry.id === selectedId) || primary;
  const plan = selected ? buildFestivalPlan(selected, entries, items, categories, invoices, today) : null;
  const comparison = plan?.comparison;
  const trackedCount = comparison ? 2 : plan?.historyYears.length || 0;
  const itemNameById = new Map(items.map((item) => [item.id, localizedItemName(language, item)]));
  return (
    <div className="mt-4 space-y-4">
      <section className="festival-panel">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3>{copy.comparison}</h3><p>{selected ? copy.salesWindow + ": " + dateLabel(planningWindowStart(selected), language) + " – " + dateLabel(selected.endDate, language) : copy.noComparison}</p></div>
          <label className="product-field w-full max-w-full sm:w-56"><span>{copy.chooseFestival}</span><select value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}>{relevantFestivalEntries(entries, today).map((entry) => <option key={entry.id} value={entry.id}>{festivalEntryName(entry, language)} · {entry.year}</option>)}</select></label>
        </div>
        {!comparison && <div className="festival-empty mt-3"><strong>{copy.noComparison}</strong><p>{trackedCount === 1 && plan ? copy.oneYear(plan.historyYears[0]) : copy.noHistoryDetail}</p></div>}
        {comparison?.current.partial && <p className="festival-warning mt-3">{copy.partial}</p>}
      </section>
      {comparison && <>
        <section className="festival-panel">
          <h3>{copy.itemComparison}: {comparison.current.year} vs {comparison.previous.year}</h3>
          <div className="report-table-scroller mt-3" role="region" aria-label={copy.itemComparison} tabIndex={0}>
            <table className="dashboard-table min-w-[720px]"><thead><tr><th>{festivalText(language, "Item", "आइटम", "পণ্য")}</th><th className="text-right">{comparison.current.year} {copy.quantity}</th><th className="text-right">{comparison.previous.year} {copy.quantity}</th><th className="text-right">{comparison.current.year} {copy.revenue}</th><th className="text-right">{comparison.previous.year} {copy.revenue}</th></tr></thead><tbody>{comparison.itemRows.map((row) => <tr key={row.itemId}><td className="font-black">{itemNameById.get(row.itemId) || row.itemName}</td><td className="text-right">{row.currentQuantity}</td><td className="text-right">{row.previousQuantity}</td><td className="text-right">{formatMoney(row.currentRevenue)}</td><td className="text-right">{formatMoney(row.previousRevenue)}</td></tr>)}</tbody></table>
          </div>
        </section>
        <section className="festival-panel">
          <h3>{copy.categoryComparison}</h3>
          <div className="report-table-scroller mt-3" role="region" aria-label={copy.categoryComparison} tabIndex={0}>
            <table className="dashboard-table min-w-[520px]"><thead><tr><th>{copy.filterCategory}</th><th className="text-right">{comparison.current.year} {copy.revenue}</th><th className="text-right">{comparison.previous.year} {copy.revenue}</th></tr></thead><tbody>{comparison.categoryRows.map((row) => <tr key={row.categoryId}><td className="font-black">{localizedCategoryName(language, row.categoryName)}</td><td className="text-right">{formatMoney(row.currentRevenue)}</td><td className="text-right">{formatMoney(row.previousRevenue)}</td></tr>)}</tbody></table>
          </div>
        </section>
      </>}
    </div>
  );
}

function LeftoversView({ entries, items, movements, invoices, language, ownerMode, onOpenReports, today }: { entries: FestivalEntry[]; items: Item[]; movements: StockMovement[]; invoices: Invoice[]; language: Language; ownerMode: boolean; onOpenReports: () => void; today: string }) {
  const copy = festivalCopy(language);
  const rows = buildPostSeasonLeftovers(entries, items, movements, invoices, today);
  return (
    <div className="mt-4 space-y-4">
      <section className="festival-panel">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h3>{copy.leftovers}</h3><p>{copy.leftoverHelp}</p></div><button type="button" onClick={onOpenReports} className="counter-secondary">{copy.openDeadStock}</button></div>
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <article key={`${row.festival.id}:${row.item.id}`} className="festival-leftover-card">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p>{festivalEntryName(row.festival, language)} · {copy.daysPast(row.daysPast)}</p><h3>{localizedItemName(language, row.item)}</h3><small>{row.item.skuCode}</small></div><strong>{row.remainingStock} {localizedUnitName(language, row.item.baseUnit)}</strong></div>
            <div className="mt-3 grid grid-cols-2 gap-2"><span>{copy.threshold}<b>{row.threshold == null ? copy.noThreshold : row.threshold}</b></span>{ownerMode && <span>{copy.value}<b>{row.stockValue == null ? copy.missingCost : formatMoney(row.stockValue)}</b></span>}</div>
            <p className={`mt-3 ${row.carryTo ? "festival-carry" : "festival-warning"}`}>{row.carryTo ? festivalText(language, `Carry or reassign to ${festivalEntryName(row.carryTo, language)} before putting it away.`, `${festivalEntryName(row.carryTo, language)} के लिए रखें या फिर से लगाएँ, वापस रखने से पहले।`, `তুলে রাখার আগে ${festivalEntryName(row.carryTo, language)}-এর জন্য রেখে দিন বা আবার সাজান।`) : copy.putAway}</p>
          </article>
        ))}
        {!rows.length && <p className="festival-empty">{copy.noLeftovers}</p>}
      </section>
    </div>
  );
}

export default function FestivalWorkspace({ items, categories, invoices, language, ownerMode, onBackCatalogue, onOpenReports, onChanged }: Props) {
  const copy = festivalCopy(language);
  const entries = useLiveQuery(() => db.festivalEntries.orderBy("startDate").toArray(), [], []);
  const tasks = useLiveQuery(() => db.festivalTasks.toArray(), [], []);
  const stockMovements = useLiveQuery(() => db.stockMovements.toArray(), [], []);
  const [view, setView] = useState<FestivalView>("dashboard");
  const today = useLiveToday();
  const primary = useMemo(() => choosePrimaryFestival(entries, today), [entries, today]);
  const [selectedId, setSelectedId] = useState("");
  const effectiveSelectedId = entries.some((entry) => entry.id === selectedId) ? selectedId : primary?.id || "";

  return (
    <section className="mx-auto max-w-6xl px-3 py-5 md:px-7" data-festival-view={view}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBackCatalogue} className="inventory-back">← {copy.backToItems}</button>
          <p className="eyebrow mt-4">{copy.eyebrow}</p>
          <h2 className="page-title">{copy.title}</h2>
        </div>
        <span className="festival-offline-badge">✓ {copy.allOffline}</span>
      </div>
      <FestivalTabs view={view} language={language} onView={setView} />
      {view === "dashboard" && <DashboardView entries={entries} tasks={tasks} items={items} categories={categories} invoices={invoices} language={language} today={today} selectedId={effectiveSelectedId} onSelected={setSelectedId} onView={setView} onChanged={onChanged} />}
      {view === "calendar" && <CalendarView entries={entries} language={language} onChanged={onChanged} />}
      {view === "tagging" && <TaggingView entries={entries} items={items} categories={categories} language={language} onChanged={onChanged} />}
      {view === "comparison" && <ComparisonView entries={entries} items={items} categories={categories} invoices={invoices} language={language} today={today} />}
      {view === "leftovers" && <LeftoversView entries={entries} items={items} movements={stockMovements} invoices={invoices} language={language} ownerMode={ownerMode} onOpenReports={onOpenReports} today={today} />}
    </section>
  );
}
