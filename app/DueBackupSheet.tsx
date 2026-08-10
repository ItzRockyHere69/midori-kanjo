"use client";

import { useRef, useState } from "react";
import type { AccountEntry, Invoice, Language, Party, Payment } from "../lib/db";
import type { BusinessSettings } from "../lib/pdf";
import { formatMoney } from "../lib/billing";
import { formatLocalizedDateTime } from "../lib/i18n";
import {
  DuesBackupError,
  moneyFromPaise,
  parseDuesBackupFile,
  previewDuesBackupRestore,
  type DuesRestorePreview,
  type DuesRestoreResult,
} from "../lib/due-backup";
import {
  DuesLedgerError,
  downloadCurrentDuesLedgerBackup,
  parseDuesLedgerFile,
  previewDuesLedgerRestore,
  type DuesLedgerRestorePreview,
  type DuesLedgerRestoreResult,
} from "../lib/dues-ledger-archive";
import { dueCustomerRows } from "../lib/billing";
import { AccessibleSheet } from "./AccessibleDialog";
import { dueBackupCopy } from "./due-backup-copy";

export type DueBackupSession =
  | {
      step: "preview";
      mode: "complete";
      fileName: string;
      preview: DuesLedgerRestorePreview;
    }
  | {
      step: "result";
      mode: "complete";
      fileName: string;
      result: DuesLedgerRestoreResult;
    }
  | {
      step: "preview";
      mode: "legacy";
      fileName: string;
      preview: DuesRestorePreview;
    }
  | {
      step: "result";
      mode: "legacy";
      fileName: string;
      result: DuesRestoreResult;
    }
  | null;

export type DueBackupPreviewSession = Extract<NonNullable<DueBackupSession>, { step: "preview" }>;

export default function DueBackupSheet({
  parties,
  invoices,
  payments,
  accountEntries,
  business,
  language,
  ownerMode,
  session,
  restoring,
  onSession,
  onConfirm,
  onClose,
  onToast,
}: {
  parties: Party[];
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
  business: BusinessSettings;
  language: Language;
  ownerMode: boolean;
  session: DueBackupSession;
  restoring: boolean;
  onSession: (session: DueBackupSession) => void;
  onConfirm: (session: DueBackupPreviewSession) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const copy = dueBackupCopy(language);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"pdf" | "text" | "file" | null>(null);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(60);

  async function exportBackup(format: "pdf" | "text") {
    if (busy) return;
    setBusy(format);
    setError("");
    try {
      const result = await downloadCurrentDuesLedgerBackup(format, business, language);
      if (result !== "cancelled")
        onToast(copy.exportDone(format === "pdf" ? "PDF" : "TXT", result === "shared" ? copy.shared : copy.downloaded));
    } catch (cause) {
      setError(cause instanceof DuesLedgerError || cause instanceof DuesBackupError ? copy.error(cause.code) : copy.exportFailed);
    } finally {
      setBusy(null);
    }
  }

  async function chooseFile(file?: File) {
    if (!file || busy) return;
    setBusy("file");
    setError("");
    setVisibleCount(60);
    onSession(null);
    try {
      try {
        const envelope = await parseDuesLedgerFile(file);
        const preview = await previewDuesLedgerRestore(envelope);
        onSession({ step: "preview", mode: "complete", fileName: file.name, preview });
      } catch (cause) {
        if (!(cause instanceof DuesLedgerError) || cause.code !== "not_backup") throw cause;
        const envelope = await parseDuesBackupFile(file);
        const preview = await previewDuesBackupRestore(envelope);
        onSession({ step: "preview", mode: "legacy", fileName: file.name, preview });
      }
    } catch (cause) {
      setError(
        cause instanceof DuesBackupError || cause instanceof DuesLedgerError
          ? copy.error(cause.code)
          : copy.error("invalid_payload"),
      );
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const previewSession = session?.step === "preview" ? session : null;
  const preview = previewSession?.preview || null;
  const resultSession = session?.step === "result" ? session : null;
  const result = resultSession?.result || null;
  const rows = previewSession
    ? previewSession.mode === "complete"
      ? previewSession.preview.rows.slice(0, visibleCount).map((row) => ({
          key: row.record.recordId,
          status: row.status,
          name: row.record.party.name,
          codeName: row.record.party.codeName,
          phone: row.record.party.phone,
          destinationPartyName: row.destinationPartyName,
          reason: copy.ledgerReason(row.reason),
          remainingPaise: row.record.summary.remainingPaise,
          currentPaise: row.currentPaise,
          transactionCount: row.record.events.length,
        }))
      : previewSession.preview.rows.slice(0, visibleCount).map((row) => ({
          key: row.record.recordId,
          status: row.status,
          name: row.record.name,
          codeName: row.record.codeName,
          phone: row.record.phone,
          destinationPartyName: row.destinationPartyName,
          reason: copy.reason(row.reason),
          remainingPaise: row.record.remainingPaise,
          currentPaise: row.currentPaise,
          transactionCount: 0,
        }))
    : [];
  const canRestore = Boolean(preview && preview.readyCount > 0 && preview.conflictCount === 0 && !restoring && !busy);
  const complete = previewSession?.mode === "complete";
  const accountRows = dueCustomerRows(parties, payments, "", invoices, accountEntries, true);
  const totalDue = accountRows.reduce((sum, row) => sum + row.party.currentBalance, 0);
  const backupCustomerCount = previewSession
    ? complete
      ? previewSession.preview.envelope.payload.customerCount
      : previewSession.preview.envelope.payload.recordCount
    : 0;
  const backupTotalPaise = previewSession
    ? complete
      ? previewSession.preview.envelope.payload.totalRemainingPaise
      : previewSession.preview.envelope.payload.totalPaise
    : 0;
  const backupTransactions = complete && previewSession
    ? previewSession.preview.envelope.payload.transactionCount
    : 0;
  const backupSettled = complete && previewSession
    ? previewSession.preview.envelope.payload.settledCount
    : 0;

  return (
    <AccessibleSheet
      title={copy.title}
      onClose={onClose}
      closeDisabled={restoring}
      panelClassName="max-w-3xl"
      scrollClassName="p-3.5 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-5"
    >
      <div className="space-y-4" data-dues-backup-sheet>
        <section className="due-backup-intro">
          <p>{copy.helper}</p>
          <p className="due-backup-scope">{copy.balancesOnly}</p>
          <p className="due-backup-privacy">{copy.privacy}</p>
        </section>

        {!result && (
          <section className="due-backup-actions" aria-label={copy.exportHeading}>
            <div>
              <h3>{copy.exportHeading}</h3>
              <p>{accountRows.length} {copy.customers} · {formatMoney(totalDue)}</p>
            </div>
            <div className="due-backup-action-grid">
              <button type="button" disabled={Boolean(busy) || restoring} onClick={() => void exportBackup("pdf")} className="counter-primary">
                {busy === "pdf" ? "…" : `↓ ${copy.exportPdf}`}
              </button>
              <button type="button" disabled={Boolean(busy) || restoring} onClick={() => void exportBackup("text")} className="counter-secondary">
                {busy === "text" ? "…" : `↓ ${copy.exportText}`}
              </button>
            </div>
          </section>
        )}

        {!result && (
          <section className="due-backup-import">
            <div>
              <h3>{copy.importHeading}</h3>
              <p>{copy.importHelp}</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.pdf,text/plain,application/pdf"
              className="sr-only"
              aria-label={copy.importFile}
              onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
            />
            <button
              type="button"
              disabled={Boolean(busy) || restoring}
              onClick={() => fileRef.current?.click()}
              className="counter-secondary mt-3 w-full"
            >
              {busy === "file" ? copy.reading : `↑ ${copy.importFile}`}
            </button>
          </section>
        )}

        <div role="status" aria-live="polite" className="sr-only">
          {busy === "file" ? copy.reading : restoring ? copy.restoring : ""}
        </div>
        {error && <p role="alert" className="due-backup-error">{error}</p>}

        {preview && (
          <section className="due-backup-review" aria-labelledby="due-backup-review-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">{copy.review}</p>
                <h3 id="due-backup-review-title" className="mt-1 text-lg font-black break-words">{session?.step === "preview" ? session.fileName : ""}</h3>
                <p className="mt-1 text-[0.625rem] font-black text-[#335f50]">
                  {complete ? copy.completeHistory : copy.legacyBalance}
                </p>
                <p className="mt-1 break-words text-[0.625rem] text-[#68756e]">{copy.source}: {preview.envelope.payload.source.businessName}</p>
                <p className="mt-1 text-[0.625rem] text-[#68756e]">{copy.created}: {formatLocalizedDateTime(preview.envelope.payload.exportedAt, language)}</p>
              </div>
              <strong className="due-backup-total">{formatMoney(moneyFromPaise(backupTotalPaise))}</strong>
            </div>

            <div className="due-backup-summary-grid mt-4">
              <div><span>{copy.customers}</span><strong>{backupCustomerCount}</strong></div>
              {complete && <div><span>{copy.transactions}</span><strong>{backupTransactions}</strong></div>}
              {complete && <div data-tone="matched"><span>{copy.paidInFull}</span><strong>{backupSettled}</strong></div>}
              <div data-tone="new"><span>{copy.newCustomers}</span><strong>{preview.newCount}</strong></div>
              <div data-tone="matched"><span>{copy.matchedCustomers}</span><strong>{preview.matchedCount}</strong></div>
              <div data-tone="already"><span>{copy.alreadyPresent}</span><strong>{preview.alreadyCount}</strong></div>
              <div data-tone="conflict"><span>{copy.conflicts}</span><strong>{preview.conflictCount}</strong></div>
            </div>

            {preview.conflictCount > 0 && <p role="alert" className="due-backup-conflict-help mt-3">{copy.conflictHelp}</p>}
            {!preview.conflictCount && !preview.readyCount && <p className="due-backup-info mt-3">{copy.allAlready}</p>}

            <div className="due-backup-row-list mt-4" aria-label={copy.review}>
              {rows.map((row) => (
                <article key={row.key} className="due-backup-row" data-status={row.status}>
                  <div className="min-w-0">
                    <strong>{row.name}</strong>
                    <small>{[row.codeName, row.phone].filter(Boolean).join(" · ") || "—"}</small>
                    {row.destinationPartyName && row.status !== "ready_new" && (
                      <small className="due-backup-destination">{copy.destination}: {row.destinationPartyName}</small>
                    )}
                    <p>{row.reason}</p>
                    {complete && <small>{row.transactionCount} {copy.transactions}</small>}
                  </div>
                  <div className="due-backup-row-amounts">
                    <span>{copy.backupDue}<b>{formatMoney(moneyFromPaise(row.remainingPaise))}</b></span>
                    <span>{copy.currentDue}<b>{formatMoney(moneyFromPaise(row.currentPaise))}</b></span>
                    <em>{row.status === "ready_new" ? copy.willCreate : row.status === "ready_existing" ? copy.willMatch : row.status === "conflict" ? copy.blocked : copy.skipped}</em>
                  </div>
                </article>
              ))}
            </div>
            {preview.rows.length > visibleCount && (
              <button type="button" className="counter-secondary mt-3 w-full" onClick={() => setVisibleCount((count) => Math.min(preview.rows.length, count + 60))}>
                {copy.showNext(Math.min(60, preview.rows.length - visibleCount))}
              </button>
            )}

            <div className="due-backup-confirm mt-4">
              {!ownerMode && preview.readyCount > 0 && !preview.conflictCount && <p>{copy.ownerNotice}</p>}
              <button
                type="button"
                disabled={!canRestore}
                onClick={() => previewSession && onConfirm(previewSession)}
                className="counter-primary w-full"
              >
                {restoring
                  ? copy.restoring
                  : copy.restoreButton(preview.readyCount, formatMoney(moneyFromPaise(preview.readyPaise)), ownerMode)}
              </button>
            </div>
          </section>
        )}

        {result && (
          <section className="due-backup-result" role="status" aria-live="polite">
            <div className="due-backup-result-icon" aria-hidden="true">✓</div>
            <h3>{copy.resultTitle}</h3>
            <p>{copy.resultHelp}</p>
            <div className="due-backup-summary-grid mt-4">
              <div data-tone="matched"><span>{copy.imported}</span><strong>{result.importedCount}</strong></div>
              <div><span>{copy.amount}</span><strong>{formatMoney(moneyFromPaise(result.importedPaise))}</strong></div>
              {resultSession?.mode === "complete" && <div><span>{copy.transactions}</span><strong>{resultSession.result.importedTransactions}</strong></div>}
              <div data-tone="new"><span>{copy.createdCustomers}</span><strong>{result.createdCustomers}</strong></div>
              <div data-tone="already"><span>{copy.matched}</span><strong>{result.matchedCustomers}</strong></div>
            </div>
            <button type="button" className="counter-primary mt-4 w-full" onClick={onClose}>{copy.done}</button>
          </section>
        )}
      </div>
    </AccessibleSheet>
  );
}
