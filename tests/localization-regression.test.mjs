import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function extractCalls(source, name) {
  const calls = [];
  const matcher = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (const match of source.matchAll(matcher)) {
    const start = match.index;
    const open = source.indexOf("(", start);
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = open; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return calls;
}

function extractBracedBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected to find ${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`could not find the end of ${marker}`);
}

test("every Qol panel call receives the selected language", async () => {
  const source = await read("app/BillingApp.tsx");
  const panels = [
    "OwnerPinSheet",
    "GlobalSearchSheet",
    "SyncCenterSheet",
    "PaymentReceiptSheet",
    "BillPreviewSheet",
    "DailyClosePanel",
    "QualityOfLifeSettings",
  ];

  for (const panel of panels) {
    const calls = [
      ...source.matchAll(new RegExp(`<${panel}\\b[\\s\\S]*?\\/>`, "g")),
    ];
    assert.ok(calls.length > 0, `${panel} must be rendered`);
    for (const call of calls)
      assert.match(
        call[0],
        /\blanguage=\{language\}/,
        `${panel} must receive the selected language`,
      );
  }
});

test("localized export, preview, print and share calls pass language", async () => {
  const files = [
    {
      path: "app/BillingApp.tsx",
      names: [
        "printInvoice",
        "shareInvoice",
        "downloadDueStatementPdf",
        "downloadDueStatementText",
        "downloadCashFlowPdf",
        "downloadCashFlowText",
      ],
    },
    {
      path: "app/AdvancedReports.tsx",
      names: [
        "printInvoice",
        "shareInvoice",
        "shareCatalogue",
        "downloadCataloguePdf",
      ],
    },
    {
      path: "app/QolPanels.tsx",
      names: [
        "invoicePdf",
        "downloadPaymentReceipt",
        "sharePaymentReceipt",
      ],
    },
  ];

  for (const { path, names } of files) {
    const source = await read(path);
    for (const name of names) {
      const calls = extractCalls(source, name);
      assert.ok(calls.length > 0, `${path} must call ${name}`);
      for (const call of calls)
        assert.match(
          call,
          /\blanguage\b/,
          `${path} ${name} call must pass language:\n${call}`,
        );
    }
  }
});

test("payment receipt sharing reserves a browser window only for the fallback path", async () => {
  const source = await read("app/QolPanels.tsx");
  assert.match(
    source,
    /const preparedWindow = action === "share"[\s\S]{0,160}!canSharePaymentReceiptFile\(\)[\s\S]{0,80}window\.open\("", "_blank"\)/,
  );
  const calls = extractCalls(source, "sharePaymentReceipt");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\bpreparedWindow\b/);
});

test("live app copy contains no legacy mixed headings or banned formal wording", async () => {
  const appUrl = new URL("app/", root);
  const fileNames = (await readdir(appUrl)).filter((name) =>
    name.endsWith(".tsx"),
  );
  const sources = await Promise.all(
    fileNames.map(async (name) => [name, await read(`app/${name}`)]),
  );
  const legacyHeadings = [
    "Choose customer · ग्राहक चुनें",
    "Cash customer · নগদ ক্রেতা",
    "Add due manually · बकाया जोड़ें · বাকি যোগ করুন",
    "Add item · পণ্য যোগ করুন",
    "Done · ঠিক আছে",
    "Party details · পার্টির তথ্য",
    "Full history · সম্পূর্ণ খাতা",
    "Party accounts · পার্টি খাতা",
    "We have to pay · देना है",
    "Customer has to pay · लेना है",
    "Customer · ग्राहक",
    "Supplier · सप्लायर",
    "Full account activity · সম্পূর্ণ খাতা",
    "Add new customer · नया ग्राहक · নতুন ক্রেতা",
    "Add customer or supplier · नई पार्टी",
    "Items · পণ্য",
    "Khata · खाता · খাতা",
    "Customer receivables · ग्राहक उधार · ক্রেতার বাকি",
    "Business Dashboard · ব্যবসার ড্যাশবোর্ড",
    "Shop details · দোকানের তথ্য",
    "Language · भाषा · ভাষা",
    "Cloud backup · ऑफलाइन सिंक",
    "Quotation saved · कोटेशन सेव हुआ · কোটেশন সেভ হয়েছে",
    "Bill saved · बिल सेव हुआ · বিল সেভ হয়েছে",
  ];
  const bannedFormalCopy = [
    "दैनिक बिक्री",
    "पार्टी बिक्री",
    "आइटम लाभ",
    "बकाया आयु",
    "शीर्ष 20 आइटम",
    "रिपोर्ट और विकास उपकरण",
    "ग्राहक खरीद इतिहास",
    "अंतिम खरीद",
    "अभी कोई सेव की गई खरीद नहीं",
    "खर्च की श्रेणी",
    "विविध खर्च",
    "निर्यात अवधि",
    "वास्तविक प्राप्ति",
    "वास्तविक भुगतान",
    "विस्तृत नकदी लेनदेन",
    "नवीनतम 100 एंट्री",
    "দৈনিক বিক্রি",
    "পার্টি বিক্রি",
    "পণ্যের লাভ",
    "বকেয়ার বয়স",
    "সেরা ২০ পণ্য",
    "রিপোর্ট ও ব্যবসা বৃদ্ধির সরঞ্জাম",
    "ক্রেতার কেনাকাটার ইতিহাস",
    "এখনও কোনো সেভ করা কেনাকাটা নেই",
    "রপ্তানির সময়কাল",
    "প্রকৃত প্রাপ্তি",
    "প্রকৃত পেমেন্ট",
    "বিস্তারিত নগদ লেনদেন",
  ];
  const literalTrilingualHeading =
    /["'`][^"'`\n]*[A-Za-z][^"'`\n]*·[^"'`\n]*[\u0900-\u097f][^"'`\n]*·[^"'`\n]*[\u0980-\u09ff][^"'`\n]*["'`]/u;

  for (const [name, source] of sources) {
    assert.doesNotMatch(
      source,
      literalTrilingualHeading,
      `${name} must not show three languages in one heading`,
    );
    for (const phrase of [...legacyHeadings, ...bannedFormalCopy])
      assert.ok(!source.includes(phrase), `${name} still contains: ${phrase}`);
  }
});

test("removing a bill line is confirmed before undo or line mutation", async () => {
  const source = await read("app/BillingApp.tsx");
  const removeLine = extractBracedBlock(
    source,
    "const removeLine = (index: number) =>",
  );
  const confirmIndex = removeLine.indexOf("const confirmed = confirm(");
  const guardIndex = removeLine.indexOf("if (!confirmed) return;");
  const undoIndex = removeLine.indexOf("rememberLineUndo(");
  const mutationIndex = removeLine.indexOf("setLines(");

  assert.ok(confirmIndex >= 0, "removeLine must ask for confirmation");
  assert.ok(guardIndex > confirmIndex, "a rejected confirmation must return");
  assert.ok(undoIndex > guardIndex, "undo state must only change after confirmation");
  assert.ok(mutationIndex > guardIndex, "bill lines must only change after confirmation");
});

test("GSTR CSV neutralizes formula-leading text without changing numeric cells", async () => {
  const source = await read("app/BillingApp.tsx");
  const moreScreen = source.slice(source.indexOf("function MoreScreen("));

  assert.match(moreScreen, /const csvCell = \(value: string \| number\) =>/);
  assert.match(moreScreen, /typeof value === "string"/);
  assert.ok(
    moreScreen.includes("/^[\\s\\uFEFF]*[=+\\-@]/u.test(original)"),
    "formula markers after spaces or a BOM must be detected",
  );
  assert.ok(
    moreScreen.includes("/^[\\t\\r\\n]/u.test(original)"),
    "leading control whitespace must be detected",
  );
  assert.ok(
    moreScreen.includes("const safe = formulaLike ? `'${original}` : original;"),
    "formula-like text must be prefixed with an apostrophe",
  );
  assert.match(moreScreen, /row\.map\(csvCell\)\.join\(","\)/);
});
