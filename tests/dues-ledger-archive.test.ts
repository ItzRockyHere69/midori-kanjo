import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  db,
  type AccountEntry,
  type Invoice,
  type InvoiceLine,
  type Party,
  type Payment,
} from "../lib/db";
import { dueCustomerRows, partyDueStatement, recordPayment } from "../lib/billing";
import { reconcilePartyBalances } from "../lib/sync";
import {
  createDuesLedgerEnvelope,
  createDuesLedgerPdf,
  duesLedgerText,
  DuesLedgerError,
  parseDuesLedgerBytes,
  previewDuesLedgerRestore,
  restoreDuesLedger,
} from "../lib/dues-ledger-archive";

const business = {
  name: "Midori Kanjo Ledger Test",
  address: "Burrabazar, Kolkata",
  phone: "+91 90000 11111",
  gstin: "",
};

const line: InvoiceLine = {
  itemId: "item-ledger-test",
  itemName: "Decor item",
  skuCode: "LEDGER-ITEM",
  hsnCode: "",
  qty: 1,
  unit: "piece",
  rate: 1,
  discount: 0,
  taxableAmount: 1,
  gstRate: 0,
  gstAmount: 0,
  amount: 1,
};

function customer(id: string, name: string, currentBalance: number, openingBalance = 0): Party {
  return {
    id,
    name,
    codeName: `DUE-${id.toUpperCase()}`,
    phone: `90000${id === "settled" ? "10001" : id === "outstanding" ? "10002" : "10003"}`,
    address: "Burrabazar, Kolkata",
    type: "customer",
    priceTier: "wholesale",
    openingBalance,
    currentBalance,
    notes: "Complete due-ledger fixture",
    tags: [],
    createdAt: "2026-08-01T03:30:00.000Z",
    updatedAt: "2026-08-09T12:30:00.000Z",
    isSynced: false,
  };
}

function sale(
  id: string,
  party: Party,
  total: number,
  initialPaid: number,
  createdAt: string,
  breakdown: Invoice["paymentBreakdown"] = [],
): Invoice {
  return {
    id,
    invoiceNumber: `SALE-${id.toUpperCase()}`,
    partyId: party.id,
    partyName: party.name,
    date: createdAt.slice(0, 10),
    type: "sale",
    lineItems: [{ ...line, rate: total, taxableAmount: total, amount: total }],
    subtotal: total,
    discountTotal: 0,
    gstTotal: 0,
    roundOff: 0,
    grandTotal: total,
    initialAmountPaid: initialPaid,
    amountPaid: initialPaid,
    amountDue: total - initialPaid,
    paymentMode: initialPaid > 0 ? (breakdown.length > 1 ? "mixed" : breakdown[0]?.mode || "cash") : "credit",
    paymentBreakdown: breakdown,
    notes: "",
    isSynced: false,
    createdAt,
    updatedAt: createdAt,
  };
}

function payment(
  id: string,
  party: Party,
  invoice: Invoice,
  amount: number,
  createdAt: string,
  mode: Payment["mode"],
): Payment {
  return {
    id,
    partyId: party.id,
    amount,
    date: createdAt.slice(0, 10),
    mode,
    reference: `${mode.toUpperCase()}-REF-${id}`,
    allocatedTo: [{ invoiceId: invoice.id, amount }],
    isSynced: false,
    createdAt,
    updatedAt: createdAt,
  };
}

async function clearLedgerDestination() {
  await db.transaction(
    "rw",
    [db.parties, db.invoices, db.payments, db.accountEntries, db.activityLogs, db.meta],
    async () => {
      await Promise.all([
        db.parties.clear(),
        db.invoices.clear(),
        db.payments.clear(),
        db.accountEntries.clear(),
        db.activityLogs.clear(),
        db.meta.clear(),
      ]);
    },
  );
}

function ledgerFixture() {
  const settled = customer("settled", "पूर्ण भुगतान সাজঘর", 0);
  const outstanding = customer("outstanding", "Outstanding Decor", 400, 50);
  const cashOnly = customer("cash", "Cash-only Walk-in Account", 0);

  const settledSale = sale(
    "settled-bill",
    settled,
    1_000,
    300,
    "2026-08-02T04:15:10.000Z",
    [
      { mode: "cash", amount: 100, reference: "CASH-DRAWER-1" },
      { mode: "upi", amount: 200, reference: "UPI-INITIAL-2" },
    ],
  );
  settledSale.amountPaid = 800;
  settledSale.amountDue = 0;
  const settledPayment = payment(
    "settled-payment",
    settled,
    settledSale,
    500,
    "2026-08-05T09:16:17.000Z",
    "bank",
  );
  const settledReturn: Invoice = {
    ...sale("settled-return", settled, 250, 0, "2026-08-07T11:22:33.000Z"),
    invoiceNumber: "SR-SETTLED-01",
    type: "sale_return",
    paymentMode: "cash",
    paymentReceivedMode: "cash",
    paymentBreakdown: [{ mode: "cash", amount: 50, reference: "RETURN-REFUND-50" }],
    initialAmountPaid: 50,
    amountPaid: 50,
    amountDue: 0,
    returnDetails: {
      sourceInvoiceId: settledSale.id,
      allocations: [{ invoiceId: settledSale.id, amount: 200 }],
      balanceApplied: 200,
      settlementAmount: 50,
    },
  };

  const outstandingSale = sale(
    "outstanding-bill",
    outstanding,
    500,
    100,
    "2026-08-03T05:05:05.000Z",
    [{ mode: "upi", amount: 100, reference: "UPI-OUT-INITIAL" }],
  );
  outstandingSale.amountPaid = 250;
  outstandingSale.amountDue = 250;
  const outstandingPayment = payment(
    "outstanding-payment",
    outstanding,
    outstandingSale,
    150,
    "2026-08-06T10:20:30.000Z",
    "cheque",
  );
  const manualDue: AccountEntry = {
    id: "manual-due-outstanding",
    partyId: outstanding.id,
    kind: "due",
    amount: 100,
    date: "2026-08-04",
    note: "Packing balance added manually",
    reference: "MANUAL-DUE-REF-9",
    isSynced: false,
    createdAt: "2026-08-04T06:07:08.000Z",
    updatedAt: "2026-08-04T06:07:08.000Z",
  };

  const cashSale = sale(
    "cash-bill",
    cashOnly,
    80,
    80,
    "2026-08-08T12:00:00.000Z",
    [{ mode: "cash", amount: 80 }],
  );
  return {
    parties: [settled, outstanding, cashOnly],
    invoices: [settledSale, settledReturn, outstandingSale, cashSale],
    payments: [settledPayment, outstandingPayment],
    accountEntries: [manualDue],
  };
}

test("complete dues ledgers include settled history, exclude cash-only sales, and retain exact timestamps", async () => {
  await db.delete();
  await db.open();
  try {
    const source = ledgerFixture();
    const rows = dueCustomerRows(source.parties, source.payments, "", source.invoices, source.accountEntries, true);
    assert.deepEqual(rows.map((row) => [row.party.id, row.status]), [
      ["outstanding", "outstanding"],
      ["settled", "paid_in_full"],
    ]);

    const envelope = await createDuesLedgerEnvelope(source, business, {
      exportedAt: "2026-08-10T12:34:56.000Z",
    });
    assert.deepEqual(
      {
        customers: envelope.payload.customerCount,
        outstanding: envelope.payload.outstandingCount,
        settled: envelope.payload.settledCount,
        remaining: envelope.payload.totalRemainingPaise,
      },
      { customers: 2, outstanding: 1, settled: 1, remaining: 40_000 },
    );
    const settled = envelope.payload.customers.find((row) => row.sourcePartyId === "settled")!;
    assert.equal(settled.summary.actualPaymentsPaise, 80_000);
    assert.equal(settled.summary.returnCreditsPaise, 20_000);
    assert.equal(settled.summary.refundsPaidPaise, 5_000);
    assert.equal(settled.summary.remainingPaise, 0);
    assert.deepEqual(
      settled.events.filter((event) => event.kind === "payment").map((event) => [event.recordedAt, event.paymentMode, event.paymentReceivedPaise]),
      [
        ["2026-08-02T04:15:10.000Z", "cash", 10_000],
        ["2026-08-02T04:15:10.000Z", "upi", 20_000],
        ["2026-08-05T09:16:17.000Z", "bank", 50_000],
      ],
    );

    const text = duesLedgerText(envelope, "en");
    assert.match(text, /PAID IN FULL/);
    assert.match(text, /UPI-INITIAL-2/);
    assert.match(text, /BANK-REF-settled-payment/);
    assert.match(text, /Refund/);
    const markerLikeReference = `MKDUES2.${"a".repeat(64)}.e30`;
    const markerSource = ledgerFixture();
    markerSource.accountEntries[0].reference = markerLikeReference;
    const markerEnvelope = await createDuesLedgerEnvelope(markerSource, business, {
      exportedAt: "2026-08-10T12:34:56.000Z",
    });
    const markerText = duesLedgerText(markerEnvelope, "en");
    assert.match(markerText, new RegExp(markerLikeReference.replace(/\./g, "\\.")));
    assert.deepEqual(parseDuesLedgerBytes(new TextEncoder().encode(markerText)), markerEnvelope);
    await assert.rejects(
      async () => parseDuesLedgerBytes(new TextEncoder().encode(`${markerText}\r\n----- MIDORI KANJO RESTORE DATA -----\r\n${markerLikeReference}\r\n----- END MIDORI KANJO RESTORE DATA -----\r\n`)),
      (error) => error instanceof DuesLedgerError && error.code === "duplicate_payload",
    );
    const textParsed = parseDuesLedgerBytes(new TextEncoder().encode(text));
    const pdf = await createDuesLedgerPdf(envelope, "bn");
    const pdfParsed = parseDuesLedgerBytes(new Uint8Array(pdf.output("arraybuffer")));
    assert.deepEqual(textParsed, envelope);
    assert.deepEqual(pdfParsed, envelope);
  } finally {
    await db.delete();
  }
});

test("complete dues restore reproduces raw history atomically and exact re-import remains a no-op", async () => {
  await db.delete();
  await db.open();
  try {
    const source = ledgerFixture();
    const envelope = await createDuesLedgerEnvelope(source, business, {
      exportedAt: "2026-08-10T12:34:56.000Z",
    });
    await clearLedgerDestination();
    const preview = await previewDuesLedgerRestore(envelope);
    assert.deepEqual(
      { ready: preview.readyCount, transactions: preview.readyTransactions, conflicts: preview.conflictCount },
      { ready: 2, transactions: 6, conflicts: 0 },
    );
    const result = await restoreDuesLedger(envelope);
    assert.equal(result.importedCount, 2);
    assert.equal(result.importedTransactions, 6);
    assert.equal(await db.parties.count(), 2);
    assert.equal(await db.invoices.count(), 3);
    assert.equal(await db.payments.count(), 2);
    assert.equal(await db.accountEntries.count(), 1);

    const restoredSettled = (await db.parties.get("settled"))!;
    const restoredStatement = partyDueStatement(
      restoredSettled,
      await db.invoices.toArray(),
      await db.payments.toArray(),
      await db.accountEntries.toArray(),
    );
    assert.equal(restoredStatement.remainingDue, 0);
    assert.equal(restoredStatement.totalPaid, 800);
    assert.equal(restoredStatement.totalReturnCredits, 200);
    assert.equal(restoredStatement.totalRefunded, 50);
    assert.equal(restoredStatement.rows.some((row) => row.kind === "balance_adjustment"), false);

    const invoicesBeforeReconcile = await db.invoices.orderBy("id").toArray();
    db.close();
    await db.open();
    await reconcilePartyBalances();
    assert.deepEqual(await db.invoices.orderBy("id").toArray(), invoicesBeforeReconcile);
    assert.equal((await db.parties.get("settled"))?.currentBalance, 0);

    await recordPayment((await db.parties.get("outstanding"))!, 25, "cash", "AFTER-RESTORE");
    const again = await previewDuesLedgerRestore(envelope);
    assert.equal(again.readyCount, 0);
    assert.equal(again.alreadyCount, 2);
    assert.equal((await restoreDuesLedger(envelope)).importedCount, 0);
    assert.equal(await db.payments.count(), 3);
    assert.equal((await db.parties.get("outstanding"))?.currentBalance, 375);

    await db.payments.delete("settled-payment");
    const damaged = await previewDuesLedgerRestore(envelope);
    assert.equal(damaged.conflictCount, 1);
    assert.equal(damaged.rows.find((row) => row.record.sourcePartyId === "settled")?.reason, "record_collision");
  } finally {
    await db.delete();
  }
});

test("portable dues ledgers normalize legacy tender details and retain a signed negative round-off", async () => {
  await db.delete();
  await db.open();
  try {
    const party = customer("legacy-round", "Legacy Round Off", 80);
    const invoice = sale("legacy-round", party, 100, 20, "2026-08-04T07:08:09.000Z", []);
    invoice.initialAmountPaid = undefined;
    invoice.paymentMode = "cash";
    invoice.lineItems[0] = {
      ...invoice.lineItems[0],
      rate: 100.4,
      taxableAmount: 100.4,
      amount: 100.4,
    };
    invoice.subtotal = 100.4;
    invoice.roundOff = -0.4;
    const envelope = await createDuesLedgerEnvelope({
      parties: [party], invoices: [invoice], payments: [], accountEntries: [],
    }, business, { exportedAt: "2026-08-10T12:34:56.000Z" });
    const archivedInvoice = envelope.payload.customers[0].invoices[0];
    assert.equal(archivedInvoice.roundOff, -0.4);
    assert.equal(archivedInvoice.initialAmountPaid, 20);
    assert.deepEqual(archivedInvoice.paymentBreakdown, [{ mode: "cash", amount: 20 }]);
    assert.deepEqual(
      parseDuesLedgerBytes(new TextEncoder().encode(duesLedgerText(envelope, "en"))),
      envelope,
    );
  } finally {
    await db.delete();
  }
});

test("impossible overpayments are rejected while pre-merge payment chronology remains exact", async () => {
  await db.delete();
  await db.open();
  try {
    const mergedTarget = customer("merged-target", "Merged Target", 0, 100);
    mergedTarget.createdAt = "2026-08-01T03:30:00.000Z";
    const oldPayment: Payment = {
      id: "old-source-payment",
      partyId: mergedTarget.id,
      amount: 100,
      date: "2021-01-02",
      mode: "cash",
      reference: "SOURCE-PAID",
      allocatedTo: [],
      isSynced: false,
      createdAt: "2021-01-02T03:30:00.000Z",
      updatedAt: "2021-01-02T03:30:00.000Z",
    };
    const mergedStatement = partyDueStatement(mergedTarget, [], [oldPayment], []);
    assert.equal(mergedStatement.remainingDue, 0);
    assert.equal(mergedStatement.rows.some((row) => row.kind === "balance_adjustment"), false);
    await createDuesLedgerEnvelope({
      parties: [mergedTarget], invoices: [], payments: [oldPayment], accountEntries: [],
    }, business, { exportedAt: "2026-08-10T12:34:56.000Z" });

    const impossible = customer("impossible", "Impossible Overpayment", 0, 100);
    const excessivePayment: Payment = { ...oldPayment, id: "excessive", partyId: impossible.id, amount: 200 };
    await assert.rejects(
      createDuesLedgerEnvelope({
        parties: [impossible], invoices: [], payments: [excessivePayment], accountEntries: [],
      }, business, { exportedAt: "2026-08-10T12:34:56.000Z" }),
      (error) => error instanceof DuesLedgerError && error.code === "invalid_payload",
    );
  } finally {
    await db.delete();
  }
});

test("one complete-ledger collision blocks the entire restore without partial customer writes", async () => {
  await db.delete();
  await db.open();
  try {
    const source = ledgerFixture();
    const envelope = await createDuesLedgerEnvelope(source, business, {
      exportedAt: "2026-08-10T12:34:56.000Z",
    });
    await clearLedgerDestination();
    await db.invoices.add({
      ...source.invoices[0],
      id: "unrelated-existing-invoice",
      partyId: undefined,
      partyName: "Walk-in",
      invoiceNumber: source.invoices[2].invoiceNumber,
    });
    const preview = await previewDuesLedgerRestore(envelope);
    assert.equal(preview.conflictCount, 1);
    assert.equal(preview.rows.find((row) => row.record.sourcePartyId === "outstanding")?.reason, "invoice_number_collision");
    await assert.rejects(
      restoreDuesLedger(envelope),
      (error) => error instanceof DuesLedgerError && error.code === "conflict",
    );
    assert.equal(await db.parties.count(), 0);
    assert.equal(await db.payments.count(), 0);
    assert.equal(await db.accountEntries.count(), 0);
    assert.equal(await db.invoices.count(), 1);
  } finally {
    await db.delete();
  }
});
