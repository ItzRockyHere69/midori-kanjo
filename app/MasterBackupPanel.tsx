"use client";

import { useRef, useState } from "react";
import type { Language } from "../lib/db";
import { formatLocalizedDateTime } from "../lib/i18n";
import {
  downloadMasterBackup,
  MasterBackupError,
  parseMasterBackupFile,
  previewMasterRestore,
  restoreMasterBackup,
  type MasterRestorePreview,
} from "../lib/master-backup";

const tx = (language: Language, en: string, hi: string, bn: string) =>
  language === "hi" ? hi : language === "bn" ? bn : en;

function copyFor(language: Language) {
  return {
    eyebrow: tx(language, "Complete recovery", "पूरा रिकवरी बैकअप", "সম্পূর্ণ পুনরুদ্ধার"),
    title: tx(language, "Master backup & restore", "मास्टर बैकअप और रिस्टोर", "মাস্টার ব্যাকআপ ও ফিরিয়ে আনা"),
    helper: tx(
      language,
      "Save all customers, suppliers, bills, payments, dues, expenses, products, stock history, festival planning and portable settings in one restorable text file.",
      "सभी कस्टमर, सप्लायर, बिल, पेमेंट, बाकी, खर्च, प्रोडक्ट, स्टॉक हिस्ट्री, त्योहार प्लानिंग और पोर्टेबल सेटिंग को एक रिस्टोर होने वाली टेक्स्ट फाइल में सेव करें।",
      "সব ক্রেতা, সরবরাহকারী, বিল, পেমেন্ট, বাকি, খরচ, পণ্য, স্টক ইতিহাস, উৎসব পরিকল্পনা ও বহনযোগ্য সেটিংস একটি ফিরিয়ে আনা যায় এমন টেক্সট ফাইলে সেভ করুন।",
    ),
    locked: tx(language, "Owner Mode protects the complete business archive.", "पूरा बिज़नेस आर्काइव Owner Mode से सुरक्षित है।", "সম্পূর্ণ ব্যবসার আর্কাইভ Owner Mode দিয়ে সুরক্ষিত।"),
    unlock: tx(language, "Unlock master backup", "मास्टर बैकअप अनलॉक करें", "মাস্টার ব্যাকআপ আনলক করুন"),
    export: tx(language, "Download complete backup", "पूरा बैकअप डाउनलोड करें", "সম্পূর্ণ ব্যাকআপ ডাউনলোড করুন"),
    exporting: tx(language, "Preparing every record…", "हर रिकॉर्ड तैयार हो रहा है…", "প্রতিটি রেকর্ড প্রস্তুত হচ্ছে…"),
    import: tx(language, "Choose master backup", "मास्टर बैकअप चुनें", "মাস্টার ব্যাকআপ বাছুন"),
    reading: tx(language, "Checking the backup…", "बैकअप जाँचा जा रहा है…", "ব্যাকআপ যাচাই হচ্ছে…"),
    confidential: tx(
      language,
      "Confidential and unencrypted. The file contains complete customer and business records. Share it only with someone you trust.",
      "गोपनीय और बिना एन्क्रिप्शन की फाइल। इसमें पूरा कस्टमर और बिज़नेस डेटा है। इसे केवल भरोसेमंद व्यक्ति से शेयर करें।",
      "গোপনীয় ও এনক্রিপ্ট করা নয়। ফাইলটিতে সম্পূর্ণ ক্রেতা ও ব্যবসার তথ্য আছে। শুধু বিশ্বস্ত ব্যক্তির সঙ্গে শেয়ার করুন।",
    ),
    source: tx(language, "Source", "सोर्स", "উৎস"),
    created: tx(language, "Created", "बनाया गया", "তৈরি"),
    current: tx(language, "Current records replaced", "मौजूदा रिकॉर्ड बदले जाएँगे", "বর্তমান রেকর্ড বদলাবে"),
    restore: tx(language, "Records restored", "रिस्टोर होने वाले रिकॉर्ड", "ফিরিয়ে আনা রেকর্ড"),
    customers: tx(language, "Customers", "कस्टमर", "ক্রেতা"),
    settled: tx(language, "Paid in full", "पूरा भुगतान", "সম্পূর্ণ পরিশোধ"),
    products: tx(language, "Products", "प्रोडक्ट", "পণ্য"),
    invoices: tx(language, "Bills & documents", "बिल और दस्तावेज़", "বিল ও নথি"),
    payments: tx(language, "Payments", "पेमेंट", "পেমেন্ট"),
    expenses: tx(language, "Expenses", "खर्च", "খরচ"),
    replaceWarning: tx(
      language,
      "This is a full replacement, not a merge. Every current local record will be replaced by this backup in one all-or-nothing operation.",
      "यह पूरा रिप्लेसमेंट है, मर्ज नहीं। सभी मौजूदा लोकल रिकॉर्ड एक साथ इस बैकअप से बदलेंगे।",
      "এটি সম্পূর্ণ বদল, মার্জ নয়। সব বর্তমান লোকাল রেকর্ড একবারে এই ব্যাকআপ দিয়ে বদলে যাবে।",
    ),
    acknowledge: tx(language, "I understand that all current local data will be replaced.", "मैं समझता/समझती हूँ कि पूरा मौजूदा लोकल डेटा बदल जाएगा।", "আমি বুঝেছি যে সব বর্তমান লোকাল ডেটা বদলে যাবে।"),
    restoreButton: tx(language, "Replace all data from this backup", "इस बैकअप से पूरा डेटा बदलें", "এই ব্যাকআপ দিয়ে সব ডেটা বদলান"),
    restoring: tx(language, "Restoring all data…", "पूरा डेटा रिस्टोर हो रहा है…", "সব ডেটা ফিরিয়ে আনা হচ্ছে…"),
    cloudBlocked: tx(language, "Disconnect Cloud backup before a full restore so synchronization cannot overwrite the restored data.", "पूरा रिस्टोर करने से पहले Cloud backup डिस्कनेक्ट करें, ताकि सिंक रिस्टोर डेटा को न बदले।", "সম্পূর্ণ ফিরিয়ে আনার আগে Cloud backup বিচ্ছিন্ন করুন, যাতে সিঙ্ক ফিরিয়ে আনা ডেটা বদলে না দেয়।"),
    changed: tx(language, "Local data changed after this preview. Open the backup again and review the new replacement totals.", "इस प्रीव्यू के बाद लोकल डेटा बदल गया। बैकअप फिर खोलकर नए रिप्लेसमेंट टोटल जाँचें।", "এই প্রিভিউয়ের পরে লোকাল ডেটা বদলেছে। ব্যাকআপ আবার খুলে নতুন বদলের মোট দেখুন।"),
    ownerBadge: tx(language, "✓ Owner", "✓ मालिक", "✓ মালিক"),
    exportDone: tx(language, "Complete master backup downloaded.", "पूरा मास्टर बैकअप डाउनलोड हो गया।", "সম্পূর্ণ মাস্টার ব্যাকআপ ডাউনলোড হয়েছে।"),
    restored: tx(language, "Complete backup restored. Midori Kanjo will reopen now.", "पूरा बैकअप रिस्टोर हुआ। Midori Kanjo अब दोबारा खुलेगा।", "সম্পূর্ণ ব্যাকআপ ফিরিয়ে আনা হয়েছে। Midori Kanjo এখন আবার খুলবে।"),
    restoredWithoutDisplay: tx(language, "All business data was restored, but this device's theme or interface size could not be changed. Midori Kanjo will reopen now.", "पूरा बिज़नेस डेटा रिस्टोर हुआ, लेकिन इस डिवाइस की थीम या इंटरफेस साइज़ नहीं बदली। Midori Kanjo अब दोबारा खुलेगा।", "সব ব্যবসার ডেটা ফিরেছে, কিন্তু এই ডিভাইসের থিম বা ইন্টারফেস আকার বদলানো যায়নি। Midori Kanjo এখন আবার খুলবে।"),
    error: (code?: string) => {
      if (code === "file_too_large") return tx(language, "This master file is larger than 256 MiB.", "यह मास्टर फाइल 256 MiB से बड़ी है।", "মাস্টার ফাইলটি 256 MiB-এর বেশি।");
      if (code === "cloud_connected") return tx(language, "Disconnect Cloud backup before restoring.", "रिस्टोर से पहले Cloud backup डिस्कनेक्ट करें।", "ফিরিয়ে আনার আগে Cloud backup বিচ্ছিন্ন করুন।");
      if (code === "destination_changed") return tx(language, "Local data changed after review. Open the backup again before restoring.", "समीक्षा के बाद लोकल डेटा बदल गया। रिस्टोर से पहले बैकअप फिर खोलें।", "পর্যালোচনার পরে লোকাল ডেটা বদলেছে। ফিরিয়ে আনার আগে ব্যাকআপ আবার খুলুন।");
      if (code === "checksum_mismatch") return tx(language, "The backup failed its integrity check. It may be damaged or edited.", "बैकअप इंटीग्रिटी जाँच में फेल हुआ। यह खराब या बदला हुआ हो सकता है।", "ব্যাকআপটি ইন্টেগ্রিটি যাচাইয়ে ব্যর্থ হয়েছে। এটি ক্ষতিগ্রস্ত বা বদলানো হতে পারে।");
      if (code === "unsupported_version") return tx(language, "This backup needs a newer Midori Kanjo version.", "इस बैकअप के लिए नया Midori Kanjo वर्ज़न चाहिए।", "এই ব্যাকআপের জন্য নতুন Midori Kanjo সংস্করণ দরকার।");
      return tx(language, "The master backup is invalid or the operation was stopped safely.", "मास्टर बैकअप सही नहीं है या प्रक्रिया सुरक्षित रूप से रोक दी गई।", "মাস্টার ব্যাকআপটি সঠিক নয় অথবা কাজটি নিরাপদে বন্ধ হয়েছে।");
    },
  };
}

export default function MasterBackupPanel({
  language,
  ownerMode,
  cloudConfigured,
  onOwnerUnlock,
  onToast,
  onRestoringChange,
}: {
  language: Language;
  ownerMode: boolean;
  cloudConfigured: boolean;
  onOwnerUnlock: () => void;
  onToast: (message: string) => void;
  onRestoringChange: (restoring: boolean) => void;
}) {
  const copy = copyFor(language);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "file" | "restore" | null>(null);
  const [preview, setPreview] = useState<MasterRestorePreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  async function exportBackup() {
    if (busy || !ownerMode) return;
    setBusy("export");
    setError("");
    try {
      const result = await downloadMasterBackup();
      if (result !== "cancelled") onToast(copy.exportDone);
    } catch (cause) {
      setError(copy.error(cause instanceof MasterBackupError ? cause.code : undefined));
    } finally {
      setBusy(null);
    }
  }

  async function chooseFile(file?: File) {
    if (!file || busy || !ownerMode) return;
    setBusy("file");
    setError("");
    setPreview(null);
    setConfirmed(false);
    try {
      const envelope = await parseMasterBackupFile(file);
      setPreview(await previewMasterRestore(envelope));
      setFileName(file.name);
    } catch (cause) {
      setError(copy.error(cause instanceof MasterBackupError ? cause.code : undefined));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function restore() {
    if (!preview || busy || !ownerMode || !confirmed || cloudConfigured) return;
    setBusy("restore");
    onRestoringChange(true);
    setError("");
    try {
      const result = await restoreMasterBackup(preview.envelope, {
        cloudConfigured,
        expectedDestinationFingerprint: preview.destinationFingerprint,
      });
      onToast(result.deviceSettingsApplied ? copy.restored : copy.restoredWithoutDisplay);
      window.location.reload();
    } catch (cause) {
      onRestoringChange(false);
      setError(copy.error(cause instanceof MasterBackupError ? cause.code : undefined));
      try {
        setPreview(await previewMasterRestore(preview.envelope));
      } catch {
        setPreview(null);
      }
      setBusy(null);
    }
  }

  const fileInput = (
    <input
      key="master-backup-file"
      ref={fileRef}
      type="file"
      accept=".txt,text/plain"
      className="sr-only"
      aria-label={copy.import}
      onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
    />
  );

  if (!ownerMode) {
    return (
      <>
        <article className="dashboard-card master-backup-panel p-4 xl:col-span-12" data-master-backup-locked>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="dashboard-title mt-1">{copy.title}</h3>
          <p className="dashboard-subtitle">{copy.locked}</p>
          <button type="button" onClick={onOwnerUnlock} className="counter-secondary mt-3 max-w-sm">🔒 {copy.unlock}</button>
        </article>
        {fileInput}
      </>
    );
  }

  const summary = preview?.envelope.payload.summary;
  return (
    <>
    <article className="dashboard-card master-backup-panel p-4 xl:col-span-12" data-master-backup-unlocked>
      <div className="master-backup-heading">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="dashboard-title mt-1">{copy.title}</h3>
          <p className="dashboard-subtitle">{copy.helper}</p>
        </div>
        <span className="master-backup-owner-badge">{copy.ownerBadge}</span>
      </div>
      <p className="master-backup-confidential mt-3">{copy.confidential}</p>
      <div className="master-backup-actions mt-3">
        <button type="button" disabled={Boolean(busy)} onClick={() => void exportBackup()} className="counter-primary">
          {busy === "export" ? copy.exporting : `↓ ${copy.export}`}
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} className="counter-secondary">
          {busy === "file" ? copy.reading : `↑ ${copy.import}`}
        </button>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {busy === "export" ? copy.exporting : busy === "file" ? copy.reading : busy === "restore" ? copy.restoring : ""}
      </div>
      {error && <p className="due-backup-error mt-3" role="alert">{error}</p>}
      {preview && summary && (
        <section className="master-backup-preview mt-4" aria-label={copy.restoreButton}>
          <div className="master-backup-preview-header">
            <div className="min-w-0">
              <strong className="break-words">{fileName}</strong>
              <small>{copy.source}: {preview.envelope.payload.source.businessName}</small>
              <small>{copy.created}: {formatLocalizedDateTime(preview.envelope.payload.exportedAt, language)}</small>
            </div>
            <span>{preview.envelope.payload.database.name} v{preview.envelope.payload.database.version}</span>
          </div>
          <div className="master-backup-summary-grid mt-3">
            <div><span>{copy.current}</span><strong>{preview.currentRecords}</strong></div>
            <div><span>{copy.restore}</span><strong>{preview.willReplaceRecords}</strong></div>
            <div><span>{copy.customers}</span><strong>{summary.customers}</strong></div>
            <div data-tone="settled"><span>{copy.settled}</span><strong>{summary.settledCustomers}</strong></div>
            <div><span>{copy.products}</span><strong>{summary.products}</strong></div>
            <div><span>{copy.invoices}</span><strong>{summary.invoices}</strong></div>
            <div><span>{copy.payments}</span><strong>{summary.payments}</strong></div>
            <div><span>{copy.expenses}</span><strong>{summary.expenses}</strong></div>
          </div>
          <p className="master-backup-replace-warning mt-3">{copy.replaceWarning}</p>
          {cloudConfigured && <p className="due-backup-error mt-3" role="alert">{copy.cloudBlocked}</p>}
          <label className="master-backup-confirm mt-3">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>{copy.acknowledge}</span>
          </label>
          <button
            type="button"
            disabled={!confirmed || cloudConfigured || Boolean(busy) || !ownerMode}
            onClick={() => void restore()}
            className="counter-primary mt-3 w-full"
          >
            {busy === "restore" ? copy.restoring : copy.restoreButton}
          </button>
        </section>
      )}
    </article>
    {fileInput}
    {busy === "restore" && <div className="master-restore-lock" role="alert" aria-live="assertive">{copy.restoring}</div>}
    </>
  );
}
