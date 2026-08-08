const required = [
  "MIDORI_E2E_RUN_KEY",
  "MIDORI_E2E_SUPABASE_URL",
  "MIDORI_E2E_SUPABASE_ANON_KEY",
  "MIDORI_E2E_SYNC_CODE",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Missing GitHub Actions test secret/environment: ${missing.join(", ")}`);
  process.exit(1);
}

const url = new URL(process.env.MIDORI_E2E_SUPABASE_URL);
if (url.protocol !== "https:") {
  console.error("MIDORI_E2E_SUPABASE_URL must use HTTPS.");
  process.exit(1);
}
if (process.env.MIDORI_E2E_SYNC_CODE.trim().length < 20) {
  console.error("MIDORI_E2E_SYNC_CODE must contain at least 20 characters.");
  process.exit(1);
}

console.log("Desktop native sync-test environment is present (secret values hidden).");
