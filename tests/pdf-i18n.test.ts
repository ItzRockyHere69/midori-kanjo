import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { jsPDF } from "jspdf";
import type { Party, Payment } from "../lib/db";
import { paymentReceiptNumber, sharePaymentReceipt } from "../lib/payment-receipt";
import { registerPdfFont, setPdfFont } from "../lib/pdf-i18n";

type DynamicPdf = {
  text: (...args: unknown[]) => jsPDF;
  path: (operations: unknown, ...args: unknown[]) => jsPDF;
};

test("Indic PDF text is HarfBuzz-shaped, outlined and searchable", async () => {
  const doc = new jsPDF({ unit: "mm", format: "a4", putOnlyUsedFonts: true });
  const dynamicDoc = doc as unknown as DynamicPdf;
  const nativeText = dynamicDoc.text.bind(doc);
  const searchableLayers: Array<[string, unknown]> = [];
  dynamicDoc.text = (...args: unknown[]) => {
    const options = args[3] && typeof args[3] === "object"
      ? args[3] as { renderingMode?: unknown }
      : undefined;
    searchableLayers.push([String(args[0]), options?.renderingMode]);
    return nativeText(...args);
  };

  await registerPdfFont(doc);
  const nativePath = dynamicDoc.path.bind(doc);
  const outlineHashes: string[] = [];
  dynamicDoc.path = (operations: unknown, ...args: unknown[]) => {
    outlineHashes.push(
      createHash("sha256").update(JSON.stringify(operations)).digest("hex"),
    );
    return nativePath(operations, ...args);
  };

  setPdfFont(doc);
  doc.setFontSize(28);
  const samples = [
    ["पेमेंट", 35],
    ["क्षेत्र", 60],
    ["পেমেন্ট", 95],
    ["স্টেটমেন্ট", 120],
  ] as const;
  for (const [word, y] of samples) doc.text(word, 20, y);

  assert.deepEqual(outlineHashes, [
    "f343d04aae140f922d4edf2b5b1dd30987d2981a96a29a3c5f3f0db513e726c2",
    "94f0d663ad84ba0a23d677d9b4af632c2fce43ff4f23996e49023fd075f41c14",
    "ec37b4144999415873ac97f395b395eb8e9e07bb3f6af492436137db88f1be72",
    "14eaf21ce5dabda247a8783c14a9366ab5dd6210c22c0646c2cf4475bd2fd247",
  ]);
  assert.deepEqual(
    searchableLayers,
    samples.map(([word]) => [word, "invisible"]),
  );

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  const pdfSource = new TextDecoder("latin1").decode(bytes);
  assert.ok(bytes.byteLength > 100_000, "embedded font and shaped paths must be present");
  assert.equal((pdfSource.match(/3 Tr/g) || []).length, samples.length);
  assert.match(pdfSource, /\/ToUnicode\s+\d+\s+0\s+R/);
});

test("receipt sharing preserves Web Share activation and makes its fallback popup-safe", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const pdfApi = jsPDF.API as unknown as {
    save: (this: unknown, ...args: unknown[]) => unknown;
  };
  const previousSave = pdfApi.save;
  pdfApi.save = function () { return this; };
  const opened: Array<{ closed: boolean; opener: unknown; location: { href: string } }> = [];
  let shared: ShareData | undefined;
  let fileShareSupported = true;
  const browserWindow = {
    location: { href: "https://app.invalid/" },
    open: () => {
      const target = {
        closed: false,
        opener: {},
        location: { href: "" },
        close() { target.closed = true; },
      };
      opened.push(target);
      return target;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      canShare: () => fileShareSupported,
      share: async (data: ShareData) => { shared = data; },
    },
  });

  const stamp = "2026-08-09T10:00:00.000Z";
  const party: Party = {
    id: "party-1", name: "राहुल दास", codeName: "CUS-RAHUL", phone: "9000000000",
    address: "कोलकाता", type: "customer", priceTier: "wholesale", openingBalance: 0,
    currentBalance: 966, notes: "", tags: [], createdAt: stamp, updatedAt: stamp, isSynced: false,
  };
  const payment: Payment = {
    id: "payment-1234567890", partyId: party.id, amount: 500, date: "2026-08-09",
    mode: "upi", reference: "UPI-REF-1", allocatedTo: [], isSynced: false,
    createdAt: stamp, updatedAt: stamp,
  };
  const business = { name: "मिदोरी", address: "कोलकाता", phone: "9000000000", gstin: "" };

  try {
    const sharing = sharePaymentReceipt(payment, party, 966, business, "a5", undefined, "hi");
    assert.equal(opened.length, 0, "Web Share must retain the original transient activation");
    await sharing;
    assert.equal(shared?.title, "भुगतान रसीद");
    assert.equal(shared?.text, `भुगतान रसीद ${paymentReceiptNumber(payment)}`);

    fileShareSupported = false;
    const fallback = sharePaymentReceipt(payment, party, 966, business, "a5", undefined, "bn");
    assert.equal(opened.length, 1, "the fallback popup must open before the first await");
    await fallback;
    assert.match(opened[0].location.href, /^https:\/\/wa\.me\/9000000000\?text=/);
    assert.match(decodeURIComponent(opened[0].location.href), /পেমেন্ট রসিদ RCP-/);

    const brokenBusiness = {
      get name(): string { throw new Error("forced PDF failure"); },
      address: "", phone: "", gstin: "",
    };
    const failing = sharePaymentReceipt(payment, party, 966, brokenBusiness, "a5", "अपना संदेश", "hi");
    assert.equal(opened.length, 2, "a second share must reserve its own tab synchronously");
    await assert.rejects(failing, /forced PDF failure/);
    assert.equal(opened[1].closed, true, "PDF failure must close the reserved tab");
  } finally {
    pdfApi.save = previousSave;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as { window?: unknown }).window;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
