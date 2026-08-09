"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  db,
  localDate,
  type ActivityLog,
  type DailyClose,
  type Expense,
  type Invoice,
  type Item,
  type Language,
  type Party,
  type Payment,
} from "../lib/db";
import { formatMoney, fuzzyScore, partyMatchesSearch } from "../lib/billing";
import {
  formatLocalizedDate,
  formatLocalizedDateTime,
  localeForLanguage,
  localizedInvoicePartyName,
  localizedItemName,
  localizedItemSecondaryName,
} from "../lib/i18n";
import type { BusinessSettings, InvoiceFormat } from "../lib/pdf";
import { invoicePdf } from "../lib/pdf";
import {
  defaultPrinterProfiles,
  defaultWorkspace,
  dailyCashSummary,
  localizedDefaultMessageTemplates,
  partyDuplicateCandidates,
  renderMessageTemplate,
  saveDailyClose,
  setOwnerPin,
  verifyOwnerPin,
  type MessageTemplates,
  type PrinterProfile,
  type WorkspacePreferences,
  type WorkspaceTab,
} from "../lib/qol";
import {
  canSharePaymentReceiptFile,
  downloadPaymentReceipt,
  paymentReceiptNumber,
  sharePaymentReceipt,
} from "../lib/payment-receipt";
import { isNativeApp } from "../lib/native-files";
import type { SyncDiagnostics } from "../lib/sync";
import { AccessibleSheet } from "./AccessibleDialog";

type SettingsSection =
  | "workspace"
  | "printer"
  | "messages"
  | "duplicates"
  | "activity";
type PendingKey = keyof SyncDiagnostics["pending"];
type MessageKind = keyof MessageTemplates;

const enQolCopy = {
  owner: {
    unlockTitle: "Unlock Owner Mode",
    createTitle: "Create Owner PIN",
    privateView: "Private cost & profit view",
    helper:
      "PIN checking is protected with PBKDF2 and saved only on this device. Owner Mode locks when the app is hidden.",
    ownerPin: "Owner PIN",
    newPin: "New PIN (4–8 digits)",
    confirmPin: "Confirm PIN",
    checking: "Checking…",
    unlock: "Unlock Owner Mode",
    saveAndUnlock: "Save PIN & unlock",
    mismatch: "The PINs do not match.",
    incorrect: "The Owner PIN is incorrect.",
    verifyError: "The Owner PIN could not be checked.",
    invalidLength: "Use a PIN with 4 to 8 digits.",
    storageUnavailable: "Secure PIN storage is unavailable on this device.",
    locked: (seconds: number) =>
      `Owner PIN is locked for now. Try again in ${seconds} seconds.`,
    created: "Owner PIN created. Cost and profit details are unlocked.",
  },
  search: {
    title: "Search everything · Ctrl/⌘ K",
    inputLabel: "Search customers, products, or bills",
    placeholder: "Customer, code, phone, address, item, SKU or bill number",
    emptyTitle: "One search for the whole workspace",
    emptyHelper:
      "Cost and profit stay hidden unless Owner Mode is unlocked.",
    due: "Due",
    cost: "Cost",
    noMatch: "No matching customer, product or bill.",
    openParty: (name: string) => `Open account for ${name}`,
    openItem: (name: string) => `Add ${name} to the bill`,
    openInvoice: (number: string) => `Open bill ${number}`,
  },
  sync: {
    title: "Offline & cloud backup centre",
    notConfigured: "Cloud backup is not set up",
    needsAttention: "Backup needs attention",
    backedUp: "Everything is backed up",
    waiting: "Changes are waiting",
    lastSuccess: "Last successful backup",
    never: "Never",
    pendingLabels: {
      parties: "Parties",
      items: "Items",
      prices: "Rates",
      invoices: "Bills",
      payments: "Payments",
      dues: "Dues",
      expenses: "Expenses",
    },
    conflicts: (count: number) =>
      `${count} newer cloud edit${count === 1 ? "" : "s"} replaced older offline data. Ledger balances were rebuilt from bills, dues and payments.`,
    backingUp: "Backing up…",
    backUpNow: (count: number) => `Back up now · ${count} pending`,
    helper:
      "Billing works without internet. Uploads use safe batches and large catalogues download page by page.",
    backupError: "Cloud backup did not finish. Check the connection and try again.",
  },
  receipt: {
    supplierTitle: "Supplier payment advice",
    customerTitle: "Payment receipt",
    paid: "Paid",
    received: "Received",
    remainingPayable: "Remaining payable",
    remainingDue: "Remaining due",
    download: "Download / print PDF receipt",
    share: "Share receipt on WhatsApp",
    done: "Done",
    working: "Preparing…",
    actionError: "The receipt could not be prepared. Try again.",
    supplierMessage: (
      amount: string,
      partyName: string,
      date: string,
      remaining: string,
      businessName: string,
    ) =>
      `Payment of ${amount} made to ${partyName} on ${date}. Remaining payable: ${remaining}. — ${businessName}`,
  },
  preview: {
    title: "Exact bill preview",
    unavailable:
      "PDF preview is not available in this browser. Use Print or Share below.",
    preparing: "Preparing exact PDF preview…",
    error: "The PDF preview could not be prepared. You can still print or share the bill.",
    frameLabel: "Bill PDF preview",
    back: "Back",
    whatsapp: "WhatsApp",
    print: "Print now",
  },
  close: {
    loadError:
      "The saved closing for this date could not be loaded. Try again before entering a count.",
    amendConfirm: (date: string) =>
      `Amend the saved closing for ${date}? The original close time will stay in the audit history.`,
    savedToast: (amended: boolean, date: string) =>
      `Daily closing ${amended ? "amended" : "saved"} for ${date}`,
    saveError: "The daily closing could not be saved. Try again.",
    eyebrow: "Counter control",
    title: "Daily closing",
    helper: "Compare expected cash with the cash counted in the drawer.",
    savedClose: "Saved close",
    savedSummary: (
      original: string,
      expected: string,
      counted: string,
      difference: string,
    ) =>
      `Original close ${original} · expected ${expected} · counted ${counted} · difference ${difference}. Live entries below may have changed since then.`,
    closingDate: "Closing date",
    openingCash: "Opening cash ₹",
    countedCash: "Counted cash ₹",
    notes: "Closing notes",
    summaryLabels: {
      sales: "Sales",
      invoiceCash: "Cash with bills",
      invoiceCashOut: "Cash paid with bills",
      customerCash: "Later customer cash",
      supplierCash: "Supplier cash",
      expensesCash: "Cash expenses",
      upiIn: "UPI in",
      bankIn: "Bank in",
      chequeIn: "Cheque in",
    },
    expectedCash: "Expected cash",
    overShort: "Over / short",
    loading: "Loading closing…",
    saving: "Saving closing…",
    amend: "Amend saved close",
    closeDay: "Close day",
  },
  settings: {
    title: "Quality-of-life controls",
    helper:
      "Counter layout, print profiles, WhatsApp wording, duplicate review and audit history.",
    ownerConfigured: "Owner PIN configured",
    setOwnerPin: "Set owner PIN",
    sectionLabel: "Quality-of-life settings section",
    sections: {
      workspace: "Workspace",
      printer: "Printers",
      messages: "Messages",
      duplicates: "Duplicates",
      activity: "Activity",
    },
    workspaceHelper:
      "Bill and More always stay available. Choose the other tabs and the opening screen.",
    workspaceTabs: {
      bill: "Bill",
      parties: "Parties",
      dues: "Dues",
      items: "Items",
      misc: "Expenses",
      reports: "Reports",
      more: "More",
    },
    moveUp: (tab: string) => `Move ${tab} up`,
    moveDown: (tab: string) => `Move ${tab} down`,
    show: "Show",
    openOn: "Open app on",
    restoreWorkspace: "Restore default workspace",
    printerName: "Printer profile name",
    paperFormat: (name: string) => `Paper format for ${name}`,
    copiesFor: (name: string) => `Copies for ${name}`,
    printerProfile: "printer profile",
    thermal: "Thermal",
    copies: "copies",
    defaultPrinter: "Default",
    makeDefault: "Make default",
    printerHelper:
      "A browser cannot silently select a physical printer. Profiles remember layout and copies before the system print dialog.",
    restorePrinters: "Restore print profiles",
    templateLabels: {
      invoice: "Invoice",
      quotation: "Quotation",
      due: "Due reminder",
      payment: "Payment receipt",
      catalogue: "Catalogue",
    },
    whatsappTemplate: (kind: string) => `${kind} WhatsApp template`,
    placeholders: "Placeholders",
    restoreMessages: "Restore message defaults",
    duplicateParties: "Possible duplicate parties",
    duplicateItems: "Possible duplicate items",
    mergeFirst: "Merge first into second",
    noPartyDuplicates: "No exact name, phone or code duplicates.",
    noItemDuplicates: "No exact name or SKU duplicates.",
    mergePartyConfirm: (source: string, target: string) =>
      `Merge ${source} into ${target}? Bills, payments, dues and negotiated rates will move. The old account will be archived.`,
    mergeItemConfirm: (source: string, target: string) =>
      `Merge ${source} into ${target}? The first product will be archived, and its negotiated rates and stock will move.`,
    mergeError: "The records could not be merged. Check both records and try again.",
    activityTable: "Activity history table",
    dateTime: "Date / time",
    actor: "Actor",
    action: "Action",
    description: "Description",
    actors: { owner: "Owner", staff: "Staff" },
    actions: {
      "invoice.create": "Bill created",
      "quotation.create": "Quotation created",
      "customer.create": "Customer created",
      "supplier.create": "Supplier created",
      "party.merge": "Parties merged",
      "item.created": "Item created",
      "item.updated": "Item updated",
      "item.archived": "Item archived",
      "item.photo.update": "Photo updated",
      "item.photo.remove": "Photo removed",
      "item.merge": "Items merged",
      "payment.create": "Payment recorded",
      "due.create": "Due added",
      "expense.change": "Expense changed",
      "workspace.update": "Workspace updated",
      "daily-close.create": "Daily close saved",
      "daily-close.update": "Daily close amended",
    },
    noActivity:
      "Activity will appear after bills, payments, dues and settings changes.",
  },
  paymentModes: {
    cash: "Cash",
    upi: "UPI",
    bank: "Bank",
    cheque: "Cheque",
    credit: "Credit",
    mixed: "Mixed",
  },
} as const;

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { [Key in keyof T]: WidenCopy<T[Key]> };
type QolCopy = WidenCopy<typeof enQolCopy>;

const qolCopy: Record<Language, QolCopy> = {
  en: enQolCopy,
  hi: {
    owner: {
      unlockTitle: "Owner Mode खोलें",
      createTitle: "Owner PIN बनाएँ",
      privateView: "खरीद रेट और मुनाफ़ा—सिर्फ मालिक के लिए",
      helper:
        "PIN की जाँच PBKDF2 से सुरक्षित है और केवल इसी डिवाइस पर सेव होती है। ऐप छिपते ही Owner Mode लॉक हो जाता है।",
      ownerPin: "Owner PIN",
      newPin: "नया PIN (4–8 अंक)",
      confirmPin: "PIN दोबारा डालें",
      checking: "जाँच हो रही है…",
      unlock: "Owner Mode खोलें",
      saveAndUnlock: "PIN सेव करके खोलें",
      mismatch: "दोनों PIN एक जैसे नहीं हैं।",
      incorrect: "Owner PIN गलत है।",
      verifyError: "Owner PIN की जाँच नहीं हो सकी।",
      invalidLength: "4 से 8 अंकों का PIN डालें।",
      storageUnavailable: "इस डिवाइस पर सुरक्षित PIN स्टोरेज उपलब्ध नहीं है।",
      locked: (seconds: number) =>
        `Owner PIN अभी लॉक है। ${seconds} सेकंड बाद फिर कोशिश करें।`,
      created: "Owner PIN बन गया। खरीद रेट और मुनाफ़े की जानकारी खुल गई है।",
    },
    search: {
      title: "सब जगह खोजें · Ctrl/⌘ K",
      inputLabel: "पार्टी, सामान या बिल खोजें",
      placeholder: "पार्टी, कोड, फोन, पता, सामान, SKU या बिल नंबर",
      emptyTitle: "पूरे काम की एक ही खोज",
      emptyHelper: "Owner Mode खुला न हो तो खरीद रेट और मुनाफ़ा नहीं दिखेगा।",
      due: "बाकी",
      cost: "खरीद रेट",
      noMatch: "मिलती-जुलती कोई पार्टी, सामान या बिल नहीं मिला।",
      openParty: (name: string) => `${name} का खाता खोलें`,
      openItem: (name: string) => `${name} बिल में जोड़ें`,
      openInvoice: (number: string) => `बिल ${number} खोलें`,
    },
    sync: {
      title: "ऑफलाइन और क्लाउड बैकअप",
      notConfigured: "क्लाउड बैकअप सेट नहीं है",
      needsAttention: "बैकअप पर ध्यान दें",
      backedUp: "सब कुछ बैकअप हो गया है",
      waiting: "कुछ बदलाव बैकअप के लिए बाकी हैं",
      lastSuccess: "आखिरी सफल बैकअप",
      never: "कभी नहीं",
      pendingLabels: {
        parties: "पार्टी",
        items: "सामान",
        prices: "रेट",
        invoices: "बिल",
        payments: "पेमेंट",
        dues: "बाकी",
        expenses: "खर्च",
      },
      conflicts: (count: number) =>
        `${count} नए क्लाउड बदलावों ने पुराने ऑफलाइन डेटा को बदला। बिल, बाकी और पेमेंट से खाता बैलेंस फिर बनाया गया।`,
      backingUp: "बैकअप हो रहा है…",
      backUpNow: (count: number) => `अभी बैकअप करें · ${count} बाकी`,
      helper:
        "इंटरनेट के बिना भी बिल बनेंगे। अपलोड सुरक्षित बैच में होता है और सामान की बड़ी लिस्ट पेज-दर-पेज डाउनलोड होती है।",
      backupError: "क्लाउड बैकअप पूरा नहीं हुआ। कनेक्शन देखकर फिर कोशिश करें।",
    },
    receipt: {
      supplierTitle: "सप्लायर पेमेंट पर्ची",
      customerTitle: "पेमेंट रसीद",
      paid: "दिया",
      received: "मिला",
      remainingPayable: "अभी देना है",
      remainingDue: "अभी बाकी",
      download: "PDF रसीद डाउनलोड / प्रिंट करें",
      share: "रसीद WhatsApp पर भेजें",
      done: "हो गया",
      working: "तैयार हो रही है…",
      actionError: "रसीद तैयार नहीं हो सकी। फिर कोशिश करें।",
      supplierMessage: (
        amount: string,
        partyName: string,
        date: string,
        remaining: string,
        businessName: string,
      ) =>
        `${date} को ${partyName} को ${amount} दिए गए। अभी देना है: ${remaining}। — ${businessName}`,
    },
    preview: {
      title: "बिल का सही PDF प्रीव्यू",
      unavailable: "इस ब्राउज़र में PDF प्रीव्यू नहीं खुला। नीचे से प्रिंट या शेयर करें।",
      preparing: "PDF प्रीव्यू तैयार हो रहा है…",
      error: "PDF प्रीव्यू तैयार नहीं हुआ। बिल को फिर भी प्रिंट या शेयर कर सकते हैं।",
      frameLabel: "बिल का PDF प्रीव्यू",
      back: "वापस",
      whatsapp: "WhatsApp",
      print: "अभी प्रिंट करें",
    },
    close: {
      loadError: "इस तारीख की सेव की गई क्लोज़िंग नहीं खुली। रकम भरने से पहले फिर कोशिश करें।",
      amendConfirm: (date: string) =>
        `${date} की सेव क्लोज़िंग बदलें? पहली क्लोज़िंग का समय हिस्ट्री में रहेगा।`,
      savedToast: (amended: boolean, date: string) =>
        `${date} की डेली क्लोज़िंग ${amended ? "बदल दी गई" : "सेव हो गई"}`,
      saveError: "डेली क्लोज़िंग सेव नहीं हुई। फिर कोशिश करें।",
      eyebrow: "काउंटर कंट्रोल",
      title: "डेली क्लोज़िंग",
      helper: "सिस्टम के हिसाब से कैश और दराज़ में गिना कैश मिलाएँ।",
      savedClose: "सेव क्लोज़िंग",
      savedSummary: (
        original: string,
        expected: string,
        counted: string,
        difference: string,
      ) =>
        `पहली क्लोज़िंग ${original} · हिसाब का कैश ${expected} · गिना कैश ${counted} · फर्क ${difference}। नीचे की लाइव एंट्री बाद में बदल सकती हैं।`,
      closingDate: "क्लोज़िंग तारीख",
      openingCash: "शुरुआती कैश ₹",
      countedCash: "गिना कैश ₹",
      notes: "क्लोज़िंग नोट",
      summaryLabels: {
        sales: "बिक्री",
        invoiceCash: "बिल के साथ कैश",
        invoiceCashOut: "बिल के साथ दिया कैश",
        customerCash: "बाद में मिला कैश",
        supplierCash: "सप्लायर को कैश",
        expensesCash: "कैश खर्च",
        upiIn: "UPI से आया",
        bankIn: "बैंक में आया",
        chequeIn: "चेक से आया",
      },
      expectedCash: "हिसाब का कैश",
      overShort: "ज़्यादा / कम",
      loading: "क्लोज़िंग खुल रही है…",
      saving: "क्लोज़िंग सेव हो रही है…",
      amend: "सेव क्लोज़िंग बदलें",
      closeDay: "दिन बंद करें",
    },
    settings: {
      title: "काम आसान करने वाली सेटिंग्स",
      helper: "काउंटर लेआउट, प्रिंट प्रोफाइल, WhatsApp मैसेज, डुप्लिकेट और हिस्ट्री।",
      ownerConfigured: "Owner PIN सेट है",
      setOwnerPin: "Owner PIN सेट करें",
      sectionLabel: "काम आसान करने वाली सेटिंग्स",
      sections: {
        workspace: "वर्कस्पेस",
        printer: "प्रिंटर",
        messages: "मैसेज",
        duplicates: "डुप्लिकेट",
        activity: "हिस्ट्री",
      },
      workspaceHelper: "बिल और ‘और’ टैब हमेशा दिखेंगे। बाकी टैब और खुलने वाली स्क्रीन चुनें।",
      workspaceTabs: {
        bill: "बिल",
        parties: "पार्टी",
        dues: "बाकी",
        items: "सामान",
        misc: "खर्च",
        reports: "रिपोर्ट",
        more: "और",
      },
      moveUp: (tab: string) => `${tab} ऊपर करें`,
      moveDown: (tab: string) => `${tab} नीचे करें`,
      show: "दिखाएँ",
      openOn: "ऐप खुलते ही दिखाएँ",
      restoreWorkspace: "डिफ़ॉल्ट वर्कस्पेस वापस लाएँ",
      printerName: "प्रिंटर प्रोफाइल का नाम",
      paperFormat: (name: string) => `${name} का पेपर साइज़`,
      copiesFor: (name: string) => `${name} की कॉपी संख्या`,
      printerProfile: "प्रिंटर प्रोफाइल",
      thermal: "थर्मल",
      copies: "कॉपी",
      defaultPrinter: "डिफ़ॉल्ट",
      makeDefault: "डिफ़ॉल्ट बनाएँ",
      printerHelper: "ब्राउज़र खुद कोई प्रिंटर नहीं चुन सकता। सिस्टम प्रिंट स्क्रीन से पहले प्रोफाइल लेआउट और कॉपी याद रखता है।",
      restorePrinters: "प्रिंट प्रोफाइल वापस लाएँ",
      templateLabels: {
        invoice: "इनवॉइस",
        quotation: "कोटेशन",
        due: "बाकी रिमाइंडर",
        payment: "पेमेंट रसीद",
        catalogue: "कैटलॉग",
      },
      whatsappTemplate: (kind: string) => `${kind} का WhatsApp मैसेज`,
      placeholders: "प्लेसहोल्डर",
      restoreMessages: "डिफ़ॉल्ट मैसेज वापस लाएँ",
      duplicateParties: "शायद डुप्लिकेट पार्टी",
      duplicateItems: "शायद डुप्लिकेट सामान",
      mergeFirst: "पहले को दूसरे में मिलाएँ",
      noPartyDuplicates: "एक जैसे नाम, फोन या कोड वाली पार्टी नहीं मिली।",
      noItemDuplicates: "एक जैसे नाम या SKU वाला सामान नहीं मिला।",
      mergePartyConfirm: (source: string, target: string) =>
        `${source} को ${target} में मिलाएँ? बिल, पेमेंट, बाकी और तय रेट दूसरी पार्टी में चले जाएँगे। पुराना खाता आर्काइव होगा।`,
      mergeItemConfirm: (source: string, target: string) =>
        `${source} को ${target} में मिलाएँ? पहला सामान आर्काइव होगा और उसके तय रेट व स्टॉक दूसरे में चले जाएँगे।`,
      mergeError: "दोनों रिकॉर्ड मर्ज नहीं हो सके। रिकॉर्ड देखकर फिर कोशिश करें।",
      activityTable: "काम की हिस्ट्री",
      dateTime: "तारीख / समय",
      actor: "किसने किया",
      action: "काम",
      description: "जानकारी",
      actors: { owner: "मालिक", staff: "स्टाफ" },
      actions: {
        "invoice.create": "बिल बनाया",
        "quotation.create": "कोटेशन बनाया",
        "customer.create": "ग्राहक बनाया",
        "supplier.create": "सप्लायर बनाया",
        "party.merge": "पार्टी मिलाई",
        "item.created": "सामान बनाया",
        "item.updated": "सामान बदला",
        "item.archived": "सामान आर्काइव किया",
        "item.photo.update": "फोटो बदली",
        "item.photo.remove": "फोटो हटाई",
        "item.merge": "सामान मिलाया",
        "payment.create": "पेमेंट दर्ज किया",
        "due.create": "बाकी जोड़ा",
        "expense.change": "खर्च बदला",
        "workspace.update": "वर्कस्पेस बदला",
        "daily-close.create": "डेली क्लोज़िंग सेव की",
        "daily-close.update": "डेली क्लोज़िंग बदली",
      },
      noActivity: "बिल, पेमेंट, बाकी या सेटिंग बदलने के बाद हिस्ट्री यहाँ दिखेगी।",
    },
    paymentModes: {
      cash: "कैश",
      upi: "UPI",
      bank: "बैंक",
      cheque: "चेक",
      credit: "उधार",
      mixed: "मिला-जुला",
    },
  },
  bn: {
    owner: {
      unlockTitle: "Owner Mode খুলুন",
      createTitle: "Owner PIN তৈরি করুন",
      privateView: "কেনা দাম ও লাভ—শুধু মালিকের জন্য",
      helper: "PIN যাচাই PBKDF2 দিয়ে সুরক্ষিত এবং শুধু এই ডিভাইসে সেভ থাকে। অ্যাপ লুকোলেই Owner Mode লক হয়ে যায়।",
      ownerPin: "Owner PIN",
      newPin: "নতুন PIN (4–8 সংখ্যা)",
      confirmPin: "PIN আবার লিখুন",
      checking: "যাচাই হচ্ছে…",
      unlock: "Owner Mode খুলুন",
      saveAndUnlock: "PIN সেভ করে খুলুন",
      mismatch: "দুটি PIN মিলছে না।",
      incorrect: "Owner PIN ভুল।",
      verifyError: "Owner PIN যাচাই করা যায়নি।",
      invalidLength: "4 থেকে 8 সংখ্যার PIN দিন।",
      storageUnavailable: "এই ডিভাইসে নিরাপদ PIN স্টোরেজ নেই।",
      locked: (seconds: number) => `Owner PIN এখন লক। ${seconds} সেকেন্ড পরে আবার চেষ্টা করুন।`,
      created: "Owner PIN তৈরি হয়েছে। কেনা দাম ও লাভের তথ্য এখন খোলা।",
    },
    search: {
      title: "সব জায়গায় খুঁজুন · Ctrl/⌘ K",
      inputLabel: "পার্টি, পণ্য বা বিল খুঁজুন",
      placeholder: "পার্টি, কোড, ফোন, ঠিকানা, পণ্য, SKU বা বিল নম্বর",
      emptyTitle: "পুরো ওয়ার্কস্পেসে একসঙ্গে খুঁজুন",
      emptyHelper: "Owner Mode খোলা না থাকলে কেনা দাম ও লাভ দেখা যাবে না।",
      due: "বাকি",
      cost: "কেনা দাম",
      noMatch: "মিলছে এমন কোনো পার্টি, পণ্য বা বিল পাওয়া যায়নি।",
      openParty: (name: string) => `${name}-এর খাতা খুলুন`,
      openItem: (name: string) => `${name} বিলে যোগ করুন`,
      openInvoice: (number: string) => `বিল ${number} খুলুন`,
    },
    sync: {
      title: "অফলাইন ও ক্লাউড ব্যাকআপ",
      notConfigured: "ক্লাউড ব্যাকআপ সেট করা নেই",
      needsAttention: "ব্যাকআপ দেখে নিন",
      backedUp: "সবকিছু ব্যাকআপ হয়েছে",
      waiting: "কিছু পরিবর্তনের ব্যাকআপ বাকি",
      lastSuccess: "শেষ সফল ব্যাকআপ",
      never: "কখনও হয়নি",
      pendingLabels: {
        parties: "পার্টি",
        items: "পণ্য",
        prices: "রেট",
        invoices: "বিল",
        payments: "পেমেন্ট",
        dues: "বাকি",
        expenses: "খরচ",
      },
      conflicts: (count: number) => `${count}টি নতুন ক্লাউড পরিবর্তন পুরনো অফলাইন ডেটার জায়গায় এসেছে। বিল, বাকি ও পেমেন্ট থেকে খাতার ব্যালেন্স আবার তৈরি হয়েছে।`,
      backingUp: "ব্যাকআপ হচ্ছে…",
      backUpNow: (count: number) => `এখন ব্যাকআপ করুন · ${count}টি বাকি`,
      helper: "ইন্টারনেট ছাড়াও বিল করা যাবে। আপলোড নিরাপদ ব্যাচে হয় এবং বড় পণ্যের তালিকা পেজ ধরে ডাউনলোড হয়।",
      backupError: "ক্লাউড ব্যাকআপ শেষ হয়নি। কানেকশন দেখে আবার চেষ্টা করুন।",
    },
    receipt: {
      supplierTitle: "সাপ্লায়ার পেমেন্ট স্লিপ",
      customerTitle: "পেমেন্ট রসিদ",
      paid: "দেওয়া হয়েছে",
      received: "পাওয়া হয়েছে",
      remainingPayable: "এখনও দিতে হবে",
      remainingDue: "এখনও বাকি",
      download: "PDF রসিদ ডাউনলোড / প্রিন্ট করুন",
      share: "রসিদ WhatsApp-এ পাঠান",
      done: "হয়ে গেছে",
      working: "তৈরি হচ্ছে…",
      actionError: "রসিদ তৈরি করা যায়নি। আবার চেষ্টা করুন।",
      supplierMessage: (
        amount: string,
        partyName: string,
        date: string,
        remaining: string,
        businessName: string,
      ) => `${date}-এ ${partyName}-কে ${amount} দেওয়া হয়েছে। এখনও দিতে হবে: ${remaining}। — ${businessName}`,
    },
    preview: {
      title: "বিলের ঠিক PDF প্রিভিউ",
      unavailable: "এই ব্রাউজারে PDF প্রিভিউ খোলেনি। নিচে থেকে প্রিন্ট বা শেয়ার করুন।",
      preparing: "PDF প্রিভিউ তৈরি হচ্ছে…",
      error: "PDF প্রিভিউ তৈরি হয়নি। বিলটি তবু প্রিন্ট বা শেয়ার করতে পারবেন।",
      frameLabel: "বিলের PDF প্রিভিউ",
      back: "ফিরুন",
      whatsapp: "WhatsApp",
      print: "এখন প্রিন্ট করুন",
    },
    close: {
      loadError: "এই তারিখের সেভ করা ক্লোজিং খোলা যায়নি। টাকা লেখার আগে আবার চেষ্টা করুন।",
      amendConfirm: (date: string) => `${date}-এর সেভ করা ক্লোজিং বদলাবেন? প্রথম ক্লোজিংয়ের সময় হিস্ট্রিতে থাকবে।`,
      savedToast: (amended: boolean, date: string) => `${date}-এর ডেইলি ক্লোজিং ${amended ? "বদলানো হয়েছে" : "সেভ হয়েছে"}`,
      saveError: "ডেইলি ক্লোজিং সেভ হয়নি। আবার চেষ্টা করুন।",
      eyebrow: "কাউন্টার কন্ট্রোল",
      title: "ডেইলি ক্লোজিং",
      helper: "হিসাবের ক্যাশের সঙ্গে ড্রয়ারে গোনা ক্যাশ মিলিয়ে নিন।",
      savedClose: "সেভ করা ক্লোজিং",
      savedSummary: (
        original: string,
        expected: string,
        counted: string,
        difference: string,
      ) => `প্রথম ক্লোজিং ${original} · হিসাবের ক্যাশ ${expected} · গোনা ক্যাশ ${counted} · ফারাক ${difference}। নিচের লাইভ এন্ট্রি পরে বদলে থাকতে পারে।`,
      closingDate: "ক্লোজিংয়ের তারিখ",
      openingCash: "শুরুর ক্যাশ ₹",
      countedCash: "গোনা ক্যাশ ₹",
      notes: "ক্লোজিং নোট",
      summaryLabels: {
        sales: "বিক্রি",
        invoiceCash: "বিলের সঙ্গে ক্যাশ",
        invoiceCashOut: "বিলের সঙ্গে দেওয়া ক্যাশ",
        customerCash: "পরে পাওয়া ক্যাশ",
        supplierCash: "সাপ্লায়ারকে ক্যাশ",
        expensesCash: "ক্যাশ খরচ",
        upiIn: "UPI-তে এসেছে",
        bankIn: "ব্যাংকে এসেছে",
        chequeIn: "চেকে এসেছে",
      },
      expectedCash: "হিসাবের ক্যাশ",
      overShort: "বেশি / কম",
      loading: "ক্লোজিং খোলা হচ্ছে…",
      saving: "ক্লোজিং সেভ হচ্ছে…",
      amend: "সেভ ক্লোজিং বদলান",
      closeDay: "দিনের হিসাব বন্ধ করুন",
    },
    settings: {
      title: "কাজ সহজ করার সেটিংস",
      helper: "কাউন্টার লেআউট, প্রিন্ট প্রোফাইল, WhatsApp মেসেজ, ডুপ্লিকেট ও হিস্ট্রি।",
      ownerConfigured: "Owner PIN সেট করা আছে",
      setOwnerPin: "Owner PIN সেট করুন",
      sectionLabel: "কাজ সহজ করার সেটিংস",
      sections: {
        workspace: "ওয়ার্কস্পেস",
        printer: "প্রিন্টার",
        messages: "মেসেজ",
        duplicates: "ডুপ্লিকেট",
        activity: "হিস্ট্রি",
      },
      workspaceHelper: "বিল ও ‘আরও’ ট্যাব সবসময় দেখা যাবে। অন্য ট্যাব এবং প্রথমে কোন স্ক্রিন খুলবে, তা বাছুন।",
      workspaceTabs: {
        bill: "বিল",
        parties: "পার্টি",
        dues: "বাকি",
        items: "পণ্য",
        misc: "খরচ",
        reports: "রিপোর্ট",
        more: "আরও",
      },
      moveUp: (tab: string) => `${tab} উপরে নিন`,
      moveDown: (tab: string) => `${tab} নিচে নিন`,
      show: "দেখান",
      openOn: "অ্যাপ খুললে প্রথমে",
      restoreWorkspace: "ডিফল্ট ওয়ার্কস্পেস ফিরিয়ে আনুন",
      printerName: "প্রিন্টার প্রোফাইলের নাম",
      paperFormat: (name: string) => `${name}-এর পেপার সাইজ`,
      copiesFor: (name: string) => `${name}-এর কপি সংখ্যা`,
      printerProfile: "প্রিন্টার প্রোফাইল",
      thermal: "থার্মাল",
      copies: "কপি",
      defaultPrinter: "ডিফল্ট",
      makeDefault: "ডিফল্ট করুন",
      printerHelper: "ব্রাউজার নিজে থেকে প্রিন্টার বাছতে পারে না। সিস্টেম প্রিন্ট স্ক্রিন খোলার আগে প্রোফাইল লেআউট ও কপি মনে রাখে।",
      restorePrinters: "প্রিন্ট প্রোফাইল ফিরিয়ে আনুন",
      templateLabels: {
        invoice: "ইনভয়েস",
        quotation: "কোটেশন",
        due: "বাকির রিমাইন্ডার",
        payment: "পেমেন্ট রসিদ",
        catalogue: "ক্যাটালগ",
      },
      whatsappTemplate: (kind: string) => `${kind} WhatsApp মেসেজ`,
      placeholders: "প্লেসহোল্ডার",
      restoreMessages: "ডিফল্ট মেসেজ ফিরিয়ে আনুন",
      duplicateParties: "সম্ভাব্য ডুপ্লিকেট পার্টি",
      duplicateItems: "সম্ভাব্য ডুপ্লিকেট পণ্য",
      mergeFirst: "প্রথমটি দ্বিতীয়টির সঙ্গে মেলান",
      noPartyDuplicates: "একই নাম, ফোন বা কোডের কোনো পার্টি নেই।",
      noItemDuplicates: "একই নাম বা SKU-র কোনো পণ্য নেই।",
      mergePartyConfirm: (source: string, target: string) => `${source}-কে ${target}-এর সঙ্গে মেলাবেন? বিল, পেমেন্ট, বাকি ও ঠিক করা রেট দ্বিতীয় পার্টিতে যাবে। পুরনো খাতা আর্কাইভ হবে।`,
      mergeItemConfirm: (source: string, target: string) => `${source}-কে ${target}-এর সঙ্গে মেলাবেন? প্রথম পণ্যটি আর্কাইভ হবে এবং তার ঠিক করা রেট ও স্টক দ্বিতীয়টিতে যাবে।`,
      mergeError: "রেকর্ড দুটি মেলানো যায়নি। দুটিই দেখে আবার চেষ্টা করুন।",
      activityTable: "কাজের হিস্ট্রি",
      dateTime: "তারিখ / সময়",
      actor: "কে করেছেন",
      action: "কাজ",
      description: "বিবরণ",
      actors: { owner: "মালিক", staff: "স্টাফ" },
      actions: {
        "invoice.create": "বিল তৈরি",
        "quotation.create": "কোটেশন তৈরি",
        "customer.create": "ক্রেতা তৈরি",
        "supplier.create": "সাপ্লায়ার তৈরি",
        "party.merge": "পার্টি মেলানো",
        "item.created": "পণ্য তৈরি",
        "item.updated": "পণ্য বদলানো",
        "item.archived": "পণ্য আর্কাইভ",
        "item.photo.update": "ছবি বদলানো",
        "item.photo.remove": "ছবি বাদ দেওয়া",
        "item.merge": "পণ্য মেলানো",
        "payment.create": "পেমেন্ট রেকর্ড",
        "due.create": "বাকি যোগ",
        "expense.change": "খরচ বদলানো",
        "workspace.update": "ওয়ার্কস্পেস বদলানো",
        "daily-close.create": "ডেইলি ক্লোজিং সেভ",
        "daily-close.update": "ডেইলি ক্লোজিং বদলানো",
      },
      noActivity: "বিল, পেমেন্ট, বাকি বা সেটিং বদলালে হিস্ট্রি এখানে দেখা যাবে।",
    },
    paymentModes: {
      cash: "ক্যাশ",
      upi: "UPI",
      bank: "ব্যাংক",
      cheque: "চেক",
      credit: "বাকি",
      mixed: "মিশ্র",
    },
  },
};

const copyFor = (language: Language) => qolCopy[language];

const formatDateTime = (value: string, language: Language) =>
  formatLocalizedDateTime(value, language, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const formatShortDate = (value: string, language: Language) =>
  formatLocalizedDate(value, language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const displayItemName = (item: Item, language: Language) =>
  localizedItemName(language, item);

const normalizeSearch = (value: string, language: Language) =>
  value.normalize("NFKC").toLocaleLowerCase(localeForLanguage(language));

const localizeOwnerError = (cause: unknown, copy: QolCopy) => {
  const message = cause instanceof Error ? cause.message : "";
  const lockMatch = message.match(/Try again in (\d+) seconds?/i);
  if (lockMatch) return copy.owner.locked(Number(lockMatch[1]));
  if (message === "Owner PIN must contain 4 to 8 digits.")
    return copy.owner.invalidLength;
  if (message === "Secure random PIN storage is unavailable on this device.")
    return copy.owner.storageUnavailable;
  return copy.owner.verifyError;
};

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <AccessibleSheet
      title={title}
      onClose={onClose}
      panelClassName={wide ? "max-w-5xl" : "max-w-xl"}
      backdropClassName="z-[70] bg-[#102d27]/50"
      scrollClassName="p-4 pb-8 md:p-5"
    >
      {children}
    </AccessibleSheet>
  );
}

export function OwnerPinSheet({
  language,
  configured,
  onClose,
  onUnlocked,
  onToast,
}: {
  language: Language;
  configured: boolean;
  onClose: () => void;
  onUnlocked: () => void;
  onToast: (message: string) => void;
}) {
  const copy = copyFor(language);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!configured) {
        if (pin !== confirmPin) {
          setError(copy.owner.mismatch);
          return;
        }
        await setOwnerPin(pin);
        onToast(copy.owner.created);
      } else if (!(await verifyOwnerPin(pin))) {
        setError(copy.owner.incorrect);
        return;
      }
      onUnlocked();
    } catch (cause) {
      setError(localizeOwnerError(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={configured ? copy.owner.unlockTitle : copy.owner.createTitle}
      onClose={onClose}
    >
      <div className="rounded-2xl bg-[#f4faf0] p-4">
        <strong className="text-sm text-[#014921]">{copy.owner.privateView}</strong>
        <p className="mt-2 text-[11px] leading-5 text-[#66736d]">
          {copy.owner.helper}
        </p>
      </div>
      <label className="product-field mt-4">
        <span>{configured ? copy.owner.ownerPin : copy.owner.newPin}</span>
        <input
          autoFocus
          data-dialog-initial-focus
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
        />
      </label>
      {!configured && (
        <label className="product-field mt-3">
          <span>{copy.owner.confirmPin}</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={confirmPin}
            onChange={(event) =>
              setConfirmPin(event.target.value.replace(/\D/g, ""))
            }
          />
        </label>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]"
        >
          {error}
        </p>
      )}
      <button
        disabled={busy || pin.length < 4}
        onClick={() => void submit()}
        className="counter-primary mt-4"
      >
        {busy
          ? copy.owner.checking
          : configured
            ? copy.owner.unlock
            : copy.owner.saveAndUnlock}
      </button>
    </Modal>
  );
}

type SearchResult =
  | { type: "party"; party: Party }
  | { type: "item"; item: Item }
  | { type: "invoice"; invoice: Invoice };

export function GlobalSearchSheet({
  language,
  parties,
  items,
  invoices,
  ownerMode,
  onClose,
  onParty,
  onItem,
  onInvoice,
}: {
  language: Language;
  parties: Party[];
  items: Item[];
  invoices: Invoice[];
  ownerMode: boolean;
  onClose: () => void;
  onParty: (party: Party) => void;
  onItem: (item: Item) => void;
  onInvoice: (invoice: Invoice) => void;
}) {
  const copy = copyFor(language);
  const [query, setQuery] = useState("");
  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const partyRows: SearchResult[] = parties
      .filter(
        (party) =>
          !party.tags.some((tag) => tag.startsWith("mergedInto:")) &&
          partyMatchesSearch(party, q),
      )
      .slice(0, 8)
      .map((party) => ({ type: "party", party }));
    const itemRows: SearchResult[] = items
      .map((item) => ({ item, score: fuzzyScore(q, item) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ item }) => ({ type: "item", item }));
    const needle = normalizeSearch(q, language);
    const invoiceRows: SearchResult[] = invoices
      .filter(
        (invoice) =>
          !invoice.deletedAt &&
          normalizeSearch(
            `${invoice.invoiceNumber} ${localizedInvoicePartyName(language, invoice)} ${invoice.partyName} ${invoice.date}`,
            language,
          ).includes(needle),
      )
      .slice(0, 8)
      .map((invoice) => ({ type: "invoice", invoice }));
    return [...partyRows, ...itemRows, ...invoiceRows];
  }, [invoices, items, language, parties, query]);

  return (
    <Modal title={copy.search.title} onClose={onClose} wide>
      <label className="search-box sticky top-0 z-10">
        <span aria-hidden="true">⌕</span>
        <input
          autoFocus
          data-dialog-initial-focus
          aria-label={copy.search.inputLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search.placeholder}
        />
      </label>
      {!query.trim() && (
        <div className="py-16 text-center">
          <strong className="text-sm">{copy.search.emptyTitle}</strong>
          <p className="mt-2 text-xs text-[#747573]">{copy.search.emptyHelper}</p>
        </div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {results.map((result) => {
          if (result.type === "party")
            return (
              <button
                key={`p-${result.party.id}`}
                aria-label={copy.search.openParty(result.party.name)}
                onClick={() => onParty(result.party)}
                className="flex min-h-16 items-center gap-3 rounded-xl border border-[#e2e2db] bg-white p-3 text-left"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#f4faf0] text-lg">
                  ◎
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-xs">{result.party.name}</strong>
                  <span className="mt-1 block truncate text-[9px] text-[#747573]">
                    {[result.party.codeName, result.party.phone || result.party.address].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-1 block text-[9px] font-black text-[#b85a28]">
                    {copy.search.due} {formatMoney(result.party.currentBalance)}
                  </span>
                </span>
              </button>
            );
          if (result.type === "item") {
            const itemName = displayItemName(result.item, language);
            const itemMeta = [
              localizedItemSecondaryName(language, result.item),
              result.item.skuCode,
              formatMoney(result.item.priceWholesale),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={`i-${result.item.id}`}
                aria-label={copy.search.openItem(itemName)}
                onClick={() => onItem(result.item)}
                className="flex min-h-16 items-center gap-3 rounded-xl border border-[#e2e2db] bg-white p-3 text-left"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#fff3e8] text-lg">
                  ◫
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-xs">{itemName}</strong>
                  <span className="mt-1 block truncate text-[9px] text-[#747573]">
                    {itemMeta}
                  </span>
                  {ownerMode && (
                    <span className="mt-1 block text-[8px] font-bold text-[#014921]">
                      {copy.search.cost} {formatMoney(result.item.purchasePrice)}
                    </span>
                  )}
                </span>
              </button>
            );
          }
          return (
            <button
              key={`v-${result.invoice.id}`}
              aria-label={copy.search.openInvoice(result.invoice.invoiceNumber)}
              onClick={() => onInvoice(result.invoice)}
              className="flex min-h-16 items-center gap-3 rounded-xl border border-[#e2e2db] bg-white p-3 text-left"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#f0ede6] text-lg">
                ▤
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-xs">
                  {result.invoice.invoiceNumber}
                </strong>
                <span className="mt-1 block truncate text-[9px] text-[#747573]">
                  {localizedInvoicePartyName(language, result.invoice)} · {formatShortDate(result.invoice.date, language)}
                </span>
                <span className="mt-1 block text-[9px] font-black">
                  {formatMoney(result.invoice.grandTotal)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {query.trim() && !results.length && (
        <p className="py-14 text-center text-xs text-[#747573]">
          {copy.search.noMatch}
        </p>
      )}
    </Modal>
  );
}

export function SyncCenterSheet({
  language,
  diagnostics,
  state,
  configured,
  onClose,
  onSync,
}: {
  language: Language;
  diagnostics: SyncDiagnostics;
  state: string;
  configured: boolean;
  onClose: () => void;
  onSync: () => Promise<void>;
}) {
  const copy = copyFor(language);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [renderTime] = useState(() => Date.now());
  const ageHours = diagnostics.lastSuccess
    ? (renderTime - new Date(diagnostics.lastSuccess).getTime()) / 36e5
    : Infinity;
  const stale = configured && ageHours > 72;
  const status = !configured
    ? copy.sync.notConfigured
    : stale || diagnostics.lastError
      ? copy.sync.needsAttention
      : state === "synced"
        ? copy.sync.backedUp
        : copy.sync.waiting;

  async function runSync() {
    setBusy(true);
    setActionError("");
    try {
      await onSync();
    } catch {
      setActionError(copy.sync.backupError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={copy.sync.title} onClose={onClose}>
      <div
        className={`rounded-2xl p-4 ${stale || diagnostics.lastError || actionError ? "bg-[#fff3e8]" : "bg-[#f4faf0]"}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <strong className="text-sm">{status}</strong>
            <p className="mt-1 text-[10px] text-[#68736e]">
              {copy.sync.lastSuccess}: {diagnostics.lastSuccess
                ? formatDateTime(diagnostics.lastSuccess, language)
                : copy.sync.never}
            </p>
          </div>
          <span
            role="img"
            aria-label={status}
            className={`h-4 w-4 rounded-full ${!configured ? "bg-stone-400" : stale || diagnostics.lastError || actionError ? "bg-amber-500" : "bg-emerald-500"}`}
          />
        </div>
        {(diagnostics.lastError || actionError) && (
          <p
            role="alert"
            className="mt-3 text-[10px] font-bold text-[#9b4c28]"
          >
            {actionError || copy.sync.backupError}
          </p>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(diagnostics.pending) as PendingKey[]).map((key) => (
          <div
            key={key}
            className="rounded-xl border border-[#e2e2db] bg-white p-3"
          >
            <span className="field-caption">{copy.sync.pendingLabels[key]}</span>
            <strong className="mt-1 block text-lg text-[#014921]">
              {diagnostics.pending[key]}
            </strong>
          </div>
        ))}
      </div>
      {diagnostics.conflictCount > 0 && (
        <p className="mt-3 rounded-xl bg-[#fff3e8] p-3 text-[10px] font-bold text-[#9b4c28]">
          {copy.sync.conflicts(diagnostics.conflictCount)}
        </p>
      )}
      <button
        disabled={!configured || busy}
        onClick={() => void runSync()}
        className="counter-primary mt-4"
      >
        {busy
          ? copy.sync.backingUp
          : copy.sync.backUpNow(diagnostics.totalPending)}
      </button>
      <p className="mt-3 text-[10px] leading-5 text-[#747573]">
        {copy.sync.helper}
      </p>
    </Modal>
  );
}

export function PaymentReceiptSheet({
  language,
  payment,
  party,
  remaining,
  business,
  templates,
  format,
  onClose,
}: {
  language: Language;
  payment: Payment;
  party: Party;
  remaining: number;
  business: BusinessSettings;
  templates: MessageTemplates;
  format: InvoiceFormat;
  onClose: () => void;
}) {
  const copy = copyFor(language);
  const supplier = party.type === "supplier";
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [error, setError] = useState("");
  const date = formatShortDate(payment.date, language);
  const message = supplier
    ? copy.receipt.supplierMessage(
        formatMoney(payment.amount),
        party.name,
        date,
        formatMoney(remaining),
        business.name,
      )
    : renderMessageTemplate(templates.payment, {
        party_name: party.name,
        party_code: party.codeName,
        paid: formatMoney(payment.amount),
        due: formatMoney(remaining),
        payment_date: date,
        shop_name: business.name,
      });

  async function receiptAction(action: "download" | "share") {
    const preparedWindow = action === "share"
      && !isNativeApp()
      && !canSharePaymentReceiptFile()
      ? window.open("", "_blank")
      : null;
    setBusy(action);
    setError("");
    try {
      if (action === "download")
        await downloadPaymentReceipt(
          payment,
          party,
          remaining,
          business,
          format,
          language,
        );
      else
        await sharePaymentReceipt(
          payment,
          party,
          remaining,
          business,
          format,
          message,
          language,
          preparedWindow,
        );
    } catch {
      setError(copy.receipt.actionError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title={supplier ? copy.receipt.supplierTitle : copy.receipt.customerTitle}
      onClose={onClose}
    >
      <div className="rounded-3xl bg-[#e9f3ed] p-5 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#014921] text-xl text-white">
          ✓
        </span>
        <p className="mt-3 text-[9px] font-black tracking-wide text-[#747573]">
          {paymentReceiptNumber(payment)}
        </p>
        <h3 className="mt-1 text-lg font-black">{party.name}</h3>
        <strong className="mt-3 block text-3xl text-[#014921]">
          {formatMoney(payment.amount)}
        </strong>
        <p className="mt-2 text-xs">
          {date} · {copy.paymentModes[payment.mode]} · {supplier
            ? copy.receipt.paid
            : copy.receipt.received}
        </p>
        <p className="mt-3 rounded-xl bg-white/70 p-3 text-xs font-black text-[#b85a28]">
          {supplier ? copy.receipt.remainingPayable : copy.receipt.remainingDue}{" "}
          {formatMoney(remaining)}
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]">
          {error}
        </p>
      )}
      <div className="mt-3 grid gap-2">
        <button
          disabled={busy !== null}
          onClick={() => void receiptAction("download")}
          className="counter-primary"
        >
          {busy === "download" ? copy.receipt.working : copy.receipt.download}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => void receiptAction("share")}
          className="counter-secondary text-emerald-700"
        >
          {busy === "share" ? copy.receipt.working : copy.receipt.share}
        </button>
        <button onClick={onClose} className="counter-secondary">
          {copy.receipt.done}
        </button>
      </div>
    </Modal>
  );
}

export function BillPreviewSheet({
  language,
  invoice,
  business,
  format,
  onClose,
  onPrint,
  onShare,
}: {
  language: Language;
  invoice: Invoice;
  business: BusinessSettings;
  format: InvoiceFormat;
  onClose: () => void;
  onPrint: () => void;
  onShare: () => void;
}) {
  const copy = copyFor(language);
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void invoicePdf(invoice, business, format, language)
      .then((doc) => {
        objectUrl = URL.createObjectURL(doc.output("blob"));
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [business, format, invoice, language]);

  return (
    <Modal title={copy.preview.title} onClose={onClose} wide>
      <div className="overflow-hidden rounded-2xl border border-[#e2e2db] bg-[#eee]">
        {url ? (
          <object
            data={url}
            type="application/pdf"
            aria-label={copy.preview.frameLabel}
            className="h-[58dvh] w-full"
          >
            <div className="p-8 text-center text-xs">{copy.preview.unavailable}</div>
          </object>
        ) : (
          <div className="grid h-[45dvh] place-items-center px-6 text-center text-xs">
            {error ? copy.preview.error : copy.preview.preparing}
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={onClose} className="counter-secondary">
          {copy.preview.back}
        </button>
        <button onClick={onShare} className="counter-secondary text-emerald-700">
          {copy.preview.whatsapp}
        </button>
        <button onClick={onPrint} className="counter-primary">
          {copy.preview.print}
        </button>
      </div>
    </Modal>
  );
}

export function DailyClosePanel({
  language,
  invoices,
  payments,
  expenses,
  parties,
  onToast,
}: {
  language: Language;
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  parties: Party[];
  onToast: (message: string) => void;
}) {
  const copy = copyFor(language);
  const [date, setDate] = useState(localDate);
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);
  const [notes, setNotes] = useState("");
  const [savedClose, setSavedClose] = useState<DailyClose>();
  const [loadedDate, setLoadedDate] = useState("");
  const [closeLoading, setCloseLoading] = useState(true);
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeLoadError, setCloseLoadError] = useState("");
  const selectedDateRef = useRef(date);
  const saveRequestRef = useRef(0);

  useEffect(
    () => () => {
      saveRequestRef.current += 1;
    },
    [],
  );
  useEffect(() => {
    let active = true;
    void db.dailyCloses
      .get(`close:${date}`)
      .then((saved) => {
        if (!active) return;
        setSavedClose(saved);
        setOpening(saved?.openingCash || 0);
        setCounted(saved?.countedCash || 0);
        setNotes(saved?.notes || "");
        setLoadedDate(date);
      })
      .catch(() => {
        if (!active) return;
        setCloseLoadError(copy.close.loadError);
      })
      .finally(() => {
        if (active) setCloseLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy.close.loadError, date]);

  const currentSaved = loadedDate === date ? savedClose : undefined;
  const changeDate = (nextDate: string) => {
    selectedDateRef.current = nextDate;
    saveRequestRef.current += 1;
    setCloseSaving(false);
    setCloseLoading(true);
    setCloseLoadError("");
    setLoadedDate("");
    setSavedClose(undefined);
    setOpening(0);
    setCounted(0);
    setNotes("");
    setDate(nextDate);
  };
  const summary = useMemo(
    () => dailyCashSummary(date, invoices, payments, expenses, opening, parties),
    [date, expenses, invoices, opening, parties, payments],
  );
  const difference = counted - summary.expectedCash;
  const numberInput = (raw: string) => {
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };

  async function closeDay() {
    if (closeLoading || closeSaving || loadedDate !== date) return;
    if (currentSaved && !confirm(copy.close.amendConfirm(formatShortDate(date, language))))
      return;
    const savingDate = date;
    const requestId = ++saveRequestRef.current;
    setCloseSaving(true);
    try {
      const saved = await saveDailyClose({
        date: savingDate,
        openingCash: opening,
        expectedCash: summary.expectedCash,
        countedCash: counted,
        notes,
      });
      if (
        saveRequestRef.current !== requestId ||
        selectedDateRef.current !== savingDate
      )
        return;
      setSavedClose(saved);
      setLoadedDate(savingDate);
      onToast(
        copy.close.savedToast(
          Boolean(currentSaved),
          formatShortDate(savingDate, language),
        ),
      );
    } catch {
      if (
        saveRequestRef.current !== requestId ||
        selectedDateRef.current !== savingDate
      )
        return;
      onToast(copy.close.saveError);
    } finally {
      if (
        saveRequestRef.current === requestId &&
        selectedDateRef.current === savingDate
      )
        setCloseSaving(false);
    }
  }

  const summaryRows = [
    [copy.close.summaryLabels.sales, summary.sales],
    [copy.close.summaryLabels.invoiceCash, summary.invoiceCash],
    [copy.close.summaryLabels.invoiceCashOut, -summary.invoiceCashOut],
    [copy.close.summaryLabels.customerCash, summary.customerCash],
    [copy.close.summaryLabels.supplierCash, -summary.supplierCash],
    [copy.close.summaryLabels.expensesCash, -summary.expensesCash],
    [copy.close.summaryLabels.upiIn, summary.upiIn],
    [copy.close.summaryLabels.bankIn, summary.bankIn],
    [copy.close.summaryLabels.chequeIn, summary.chequeIn],
  ] as const;

  return (
    <article className="dashboard-card overflow-hidden xl:col-span-12">
      <div className="border-b border-[#e2e2db] p-4">
        <p className="eyebrow">{copy.close.eyebrow}</p>
        <h3 className="mt-1 text-xl text-[#014921]">{copy.close.title}</h3>
        <p className="mt-1 text-[10px] text-[#747573]">{copy.close.helper}</p>
      </div>
      {closeLoadError && (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-xl border border-[#d8a27e] bg-[#fff3e8] p-3 text-[10px] text-[#7b3519]"
        >
          {closeLoadError}
        </div>
      )}
      {currentSaved && (
        <div
          role="status"
          className="mx-4 mt-4 rounded-xl border border-[#b9cdbf] bg-[#f2f8f3] p-3 text-[10px] leading-5 text-[#285a3d]"
        >
          <strong className="block text-xs">
            {copy.close.savedClose} · {formatDateTime(currentSaved.updatedAt, language)}
          </strong>
          {copy.close.savedSummary(
            formatDateTime(currentSaved.closedAt, language),
            formatMoney(currentSaved.expectedCash),
            formatMoney(currentSaved.countedCash),
            formatMoney(currentSaved.discrepancy),
          )}
        </div>
      )}
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="grid grid-cols-2 gap-2">
          <label className="product-field col-span-2">
            <span>{copy.close.closingDate}</span>
            <input
              disabled={closeSaving}
              type="date"
              value={date}
              onChange={(event) => changeDate(event.target.value)}
            />
          </label>
          <label className="product-field">
            <span>{copy.close.openingCash}</span>
            <input
              disabled={closeLoading || closeSaving || loadedDate !== date}
              inputMode="decimal"
              value={opening || ""}
              onChange={(event) => setOpening(numberInput(event.target.value))}
            />
          </label>
          <label className="product-field">
            <span>{copy.close.countedCash}</span>
            <input
              disabled={closeLoading || closeSaving || loadedDate !== date}
              inputMode="decimal"
              value={counted || ""}
              onChange={(event) => setCounted(numberInput(event.target.value))}
            />
          </label>
          <label className="product-field col-span-2">
            <span>{copy.close.notes}</span>
            <textarea
              disabled={closeLoading || closeSaving || loadedDate !== date}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
            />
          </label>
        </div>
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {summaryRows.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-[#f7f5ef] p-3">
                <span className="field-caption">{label}</span>
                <strong className="mt-1 block text-sm">
                  {formatMoney(Number(value))}
                </strong>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[#014921] p-3 text-white">
              <span className="text-[8px] font-black uppercase opacity-75">
                {copy.close.expectedCash}
              </span>
              <strong className="mt-1 block text-xl">
                {formatMoney(summary.expectedCash)}
              </strong>
            </div>
            <div
              className={`rounded-xl p-3 ${Math.abs(difference) < 0.01 ? "bg-[#f4faf0] text-[#014921]" : "bg-[#fff3e8] text-[#9b4c28]"}`}
            >
              <span className="text-[8px] font-black uppercase">
                {copy.close.overShort}
              </span>
              <strong className="mt-1 block text-xl">{formatMoney(difference)}</strong>
            </div>
          </div>
          <button
            disabled={closeLoading || closeSaving || loadedDate !== date}
            onClick={() => void closeDay()}
            className="counter-primary mt-3"
          >
            {closeLoading
              ? copy.close.loading
              : closeSaving
                ? copy.close.saving
                : currentSaved
                  ? copy.close.amend
                  : copy.close.closeDay}
          </button>
        </div>
      </div>
    </article>
  );
}

const normalizeDigits = (value: string) =>
  value
    .replace(/[\u0966-\u096f]/g, (digit) =>
      String(digit.codePointAt(0)! - 0x0966),
    )
    .replace(/[\u09e6-\u09ef]/g, (digit) =>
      String(digit.codePointAt(0)! - 0x09e6),
    );

const duplicateKey = (value: string) =>
  normalizeDigits(value.normalize("NFKC"))
    .toLocaleLowerCase("und")
    // Indic vowel signs are marks, so keep them with Unicode letters and numbers.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

function duplicatePairs<T extends { id: string }>(
  rows: T[],
  keys: (row: T) => string[],
) {
  const seen = new Map<string, T>();
  const pairs: Array<[T, T]> = [];
  const emitted = new Set<string>();
  for (const row of rows)
    for (const raw of keys(row)) {
      const key = duplicateKey(raw);
      if (!key) continue;
      const earlier = seen.get(key);
      if (!earlier) seen.set(key, row);
      else if (earlier.id !== row.id) {
        const pairKey = [earlier.id, row.id].sort().join(":");
        if (!emitted.has(pairKey)) {
          pairs.push([earlier, row]);
          emitted.add(pairKey);
        }
      }
    }
  return pairs;
}

export function QualityOfLifeSettings({
  language,
  workspace,
  onWorkspace,
  profiles,
  onProfiles,
  templates,
  onTemplates,
  activityLogs,
  parties,
  items,
  onMergeParty,
  onMergeItem,
  ownerConfigured,
  onOwnerSetup,
}: {
  language: Language;
  workspace: WorkspacePreferences;
  onWorkspace: (value: WorkspacePreferences) => void;
  profiles: PrinterProfile[];
  onProfiles: (value: PrinterProfile[]) => void;
  templates: MessageTemplates;
  onTemplates: (value: MessageTemplates) => void;
  activityLogs: ActivityLog[];
  parties: Party[];
  items: Item[];
  onMergeParty: (source: Party, target: Party) => Promise<void>;
  onMergeItem: (source: Item, target: Item) => Promise<void>;
  ownerConfigured: boolean;
  onOwnerSetup: () => void;
}) {
  const copy = copyFor(language);
  const [section, setSection] = useState<SettingsSection>("workspace");
  const [mergeError, setMergeError] = useState("");
  const sections: SettingsSection[] = [
    "workspace",
    "printer",
    "messages",
    "duplicates",
    "activity",
  ];
  const partyPairs = useMemo(
    () => {
      const active = parties.filter(
        (party) => !party.tags.some((tag) => tag.startsWith("mergedInto:")),
      );
      const pairs: Array<[Party, Party]> = [];
      const emitted = new Set<string>();
      for (const party of active) {
        for (const match of partyDuplicateCandidates(party, active)) {
          const key = [party.id, match.id].sort().join(":");
          if (emitted.has(key)) continue;
          emitted.add(key);
          pairs.push([party, match]);
        }
      }
      return pairs;
    },
    [parties],
  );
  const itemPairs = useMemo(
    () =>
      duplicatePairs(items, (item) => [
        item.name,
        item.nameHi,
        item.nameBn,
        item.skuCode,
      ]),
    [items],
  );
  const visible = workspace.order.filter(
    (tab) => !workspace.hidden.includes(tab),
  );
  const activityDescription = (row: ActivityLog) => {
    if (language === "en") return row.description;
    const action =
      copy.settings.actions[
        row.action as keyof typeof copy.settings.actions
      ] || row.action;
    const party =
      row.entityType === "party" || row.entityType === "due"
        ? parties.find((entry) => entry.id === row.entityId)?.name
        : undefined;
    const item =
      row.entityType === "item"
        ? items.find((entry) => entry.id === row.entityId)
        : undefined;
    const invoiceNumber =
      row.entityType === "invoice"
        ? row.description.match(/^[A-Z]+-[A-Z0-9-]+/)?.[0]
        : undefined;
    const subject = item
      ? displayItemName(item, language)
      : party || invoiceNumber;
    return subject ? `${subject} · ${action}` : action;
  };
  const updateOrder = (tab: WorkspaceTab, direction: -1 | 1) => {
    const index = workspace.order.indexOf(tab);
    const next = index + direction;
    if (next < 0 || next >= workspace.order.length) return;
    const order = [...workspace.order];
    [order[index], order[next]] = [order[next], order[index]];
    onWorkspace({ ...workspace, order });
  };
  const mergeParty = async (source: Party, target: Party) => {
    if (!confirm(copy.settings.mergePartyConfirm(source.name, target.name))) return;
    setMergeError("");
    try {
      await onMergeParty(source, target);
    } catch {
      setMergeError(copy.settings.mergeError);
    }
  };
  const mergeItem = async (source: Item, target: Item) => {
    if (
      !confirm(
        copy.settings.mergeItemConfirm(
          displayItemName(source, language),
          displayItemName(target, language),
        ),
      )
    )
      return;
    setMergeError("");
    try {
      await onMergeItem(source, target);
    } catch {
      setMergeError(copy.settings.mergeError);
    }
  };

  return (
    <section className="settings-card md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3>{copy.settings.title}</h3>
          <p className="mt-1 text-[10px] text-[#747573]">
            {copy.settings.helper}
          </p>
        </div>
        <button
          onClick={onOwnerSetup}
          className="min-h-10 rounded-lg border border-[#e2e2db] bg-white px-3 text-[9px] font-black text-[#014921]"
        >
          {ownerConfigured
            ? copy.settings.ownerConfigured
            : copy.settings.setOwnerPin}
        </button>
      </div>
      <div
        className="mt-4 flex gap-2 overflow-x-auto"
        role="group"
        aria-label={copy.settings.sectionLabel}
      >
        {sections.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => setSection(key)}
            className={`min-h-10 shrink-0 rounded-lg px-3 text-[9px] font-black ${section === key ? "bg-[#014921] text-white" : "border border-[#e2e2db] bg-white"}`}
          >
            {copy.settings.sections[key]}
          </button>
        ))}
      </div>

      {section === "workspace" && (
        <div className="mt-4">
          <p className="text-[10px] text-[#747573]">
            {copy.settings.workspaceHelper}
          </p>
          <div className="mt-3 space-y-2">
            {workspace.order.map((tab, index) => {
              const label = copy.settings.workspaceTabs[tab];
              return (
                <div
                  key={tab}
                  className="flex items-center gap-2 rounded-xl border border-[#e2e2db] bg-white p-2"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f4faf0] text-[10px] font-black">
                    {index + 1}
                  </span>
                  <strong className="min-w-0 flex-1">{label}</strong>
                  <button
                    aria-label={copy.settings.moveUp(label)}
                    onClick={() => updateOrder(tab, -1)}
                    className="h-9 w-9 rounded-lg border"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={copy.settings.moveDown(label)}
                    onClick={() => updateOrder(tab, 1)}
                    className="h-9 w-9 rounded-lg border"
                  >
                    ↓
                  </button>
                  <label className="flex min-h-9 items-center gap-2 px-1 text-[9px] font-black">
                    <input
                      type="checkbox"
                      disabled={tab === "bill" || tab === "more"}
                      checked={!workspace.hidden.includes(tab)}
                      onChange={(event) =>
                        onWorkspace({
                          ...workspace,
                          hidden: event.target.checked
                            ? workspace.hidden.filter((key) => key !== tab)
                            : [...workspace.hidden, tab],
                          startTab:
                            workspace.startTab === tab && !event.target.checked
                              ? "bill"
                              : workspace.startTab,
                        })
                      }
                    />{" "}
                    {copy.settings.show}
                  </label>
                </div>
              );
            })}
          </div>
          <label className="product-field mt-3">
            <span>{copy.settings.openOn}</span>
            <select
              value={workspace.startTab}
              onChange={(event) =>
                onWorkspace({
                  ...workspace,
                  startTab: event.target.value as WorkspaceTab,
                })
              }
            >
              {visible.map((tab) => (
                <option key={tab} value={tab}>
                  {copy.settings.workspaceTabs[tab]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => onWorkspace(defaultWorkspace)}
            className="counter-secondary mt-3"
          >
            {copy.settings.restoreWorkspace}
          </button>
        </div>
      )}

      {section === "printer" && (
        <div className="mt-4 space-y-2">
          {profiles.map((profile) => {
            const profileLabel = profile.name || copy.settings.printerProfile;
            return (
              <div
                key={profile.id}
                className="grid gap-2 rounded-xl border border-[#e2e2db] bg-white p-3 sm:grid-cols-[1fr_100px_90px_auto]"
              >
                <input
                  aria-label={copy.settings.printerName}
                  value={profile.name}
                  onChange={(event) =>
                    onProfiles(
                      profiles.map((row) =>
                        row.id === profile.id
                          ? { ...row, name: event.target.value }
                          : row,
                      ),
                    )
                  }
                  className="h-11 rounded-lg border px-3 text-xs font-bold"
                />
                <select
                  aria-label={copy.settings.paperFormat(profileLabel)}
                  value={profile.format}
                  onChange={(event) =>
                    onProfiles(
                      profiles.map((row) =>
                        row.id === profile.id
                          ? {
                              ...row,
                              format: event.target.value as InvoiceFormat,
                            }
                          : row,
                      ),
                    )
                  }
                  className="h-11 rounded-lg border bg-white px-2 text-xs"
                >
                  <option value="a4">A4</option>
                  <option value="a5">A5</option>
                  <option value="thermal">{copy.settings.thermal}</option>
                </select>
                <label className="flex items-center gap-2 text-[9px] font-black">
                  <input
                    aria-label={copy.settings.copiesFor(profileLabel)}
                    type="number"
                    min={1}
                    max={5}
                    value={profile.copies}
                    onChange={(event) =>
                      onProfiles(
                        profiles.map((row) =>
                          row.id === profile.id
                            ? {
                                ...row,
                                copies: Math.min(
                                  5,
                                  Math.max(1, Number(event.target.value) || 1),
                                ),
                              }
                            : row,
                        ),
                      )
                    }
                    className="h-11 w-14 rounded-lg border px-2"
                  />{" "}
                  {copy.settings.copies}
                </label>
                <button
                  type="button"
                  aria-pressed={profile.isDefault}
                  onClick={() =>
                    onProfiles(
                      profiles.map((row) => ({
                        ...row,
                        isDefault: row.id === profile.id,
                      })),
                    )
                  }
                  className={`min-h-11 rounded-lg px-3 text-[9px] font-black ${profile.isDefault ? "bg-[#014921] text-white" : "border"}`}
                >
                  {profile.isDefault
                    ? copy.settings.defaultPrinter
                    : copy.settings.makeDefault}
                </button>
              </div>
            );
          })}
          <p className="text-[10px] text-[#747573]">
            {copy.settings.printerHelper}
          </p>
          <button
            onClick={() => onProfiles(defaultPrinterProfiles)}
            className="counter-secondary"
          >
            {copy.settings.restorePrinters}
          </button>
        </div>
      )}

      {section === "messages" && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(Object.keys(templates) as MessageKind[]).map((key) => (
            <label key={key} className="product-field">
              <span>
                {copy.settings.whatsappTemplate(
                  copy.settings.templateLabels[key],
                )}
              </span>
              <textarea
                rows={4}
                value={templates[key]}
                onChange={(event) =>
                  onTemplates({ ...templates, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <p className="text-[10px] leading-5 text-[#747573] md:col-span-2">
            {copy.settings.placeholders}: {"{{party_name}} {{party_code}} {{invoice_number}} {{total}} {{paid}} {{due}} {{payment_date}} {{shop_name}} {{item_count}} {{price_tier}}"}
          </p>
          <button
            onClick={() => onTemplates(localizedDefaultMessageTemplates[language])}
            className="counter-secondary md:col-span-2"
          >
            {copy.settings.restoreMessages}
          </button>
        </div>
      )}

      {section === "duplicates" && (
        <div className="mt-4">
          {mergeError && (
            <p role="alert" className="mb-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]">
              {mergeError}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-xs font-black">
                {copy.settings.duplicateParties} · {partyPairs.length}
              </h4>
              <div className="mt-2 space-y-2">
                {partyPairs.slice(0, 20).map(([first, second]) => (
                  <div
                    key={`${first.id}-${second.id}`}
                    className="rounded-xl border bg-white p-3"
                  >
                    <strong className="text-[11px]">
                      {first.name} ↔ {second.name}
                    </strong>
                    <p className="mt-1 text-[9px] text-[#747573]">
                      {[first.codeName, second.codeName].filter(Boolean).join(" / ")}
                    </p>
                    <button
                      onClick={() => void mergeParty(first, second)}
                      className="mt-2 text-[9px] font-black text-[#014921] underline"
                    >
                      {copy.settings.mergeFirst}
                    </button>
                  </div>
                ))}
                {!partyPairs.length && (
                  <p className="rounded-xl bg-[#f4faf0] p-4 text-xs">
                    {copy.settings.noPartyDuplicates}
                  </p>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-black">
                {copy.settings.duplicateItems} · {itemPairs.length}
              </h4>
              <div className="mt-2 space-y-2">
                {itemPairs.slice(0, 20).map(([first, second]) => (
                  <div
                    key={`${first.id}-${second.id}`}
                    className="rounded-xl border bg-white p-3"
                  >
                    <strong className="text-[11px]">
                      {displayItemName(first, language)} ↔ {displayItemName(second, language)}
                    </strong>
                    <p className="mt-1 text-[9px] text-[#747573]">
                      {first.skuCode} / {second.skuCode}
                    </p>
                    <button
                      onClick={() => void mergeItem(first, second)}
                      className="mt-2 text-[9px] font-black text-[#014921] underline"
                    >
                      {copy.settings.mergeFirst}
                    </button>
                  </div>
                ))}
                {!itemPairs.length && (
                  <p className="rounded-xl bg-[#f4faf0] p-4 text-xs">
                    {copy.settings.noItemDuplicates}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {section === "activity" && (
        <div className="mt-4">
          <div
            className="report-table-scroller"
            role="region"
            aria-label={copy.settings.activityTable}
            tabIndex={0}
          >
            <table className="dashboard-table min-w-[680px]">
              <thead>
                <tr>
                  <th>{copy.settings.dateTime}</th>
                  <th>{copy.settings.actor}</th>
                  <th>{copy.settings.action}</th>
                  <th>{copy.settings.description}</th>
                </tr>
              </thead>
              <tbody>
                {activityLogs.slice(0, 100).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt, language)}</td>
                    <td>{copy.settings.actors[row.actor]}</td>
                    <td>
                      {copy.settings.actions[
                        row.action as keyof typeof copy.settings.actions
                      ] || row.action}
                    </td>
                    <td className="font-bold">{activityDescription(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!activityLogs.length && (
            <p className="py-8 text-center text-xs text-[#747573]">
              {copy.settings.noActivity}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
