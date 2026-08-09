#!/usr/bin/env bash
set -euo pipefail

# Produces the SENSITIVE cloud-data artifact. It never prints credentials or the
# business sync code. Run it locally; do not commit its output.
umask 077

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Postgres connection string.}"
: "${MIDORI_BUSINESS_ID:?Set MIDORI_BUSINESS_ID to the private business sync code.}"

if [[ "${MIDORI_BUSINESS_ID}" == *$'\n'* || ${#MIDORI_BUSINESS_ID} -lt 20 ]]; then
  echo "MIDORI_BUSINESS_ID must be a single-line value of at least 20 characters." >&2
  exit 64
fi

command -v psql >/dev/null 2>&1 || {
  echo "psql is required. Install the PostgreSQL client tools first." >&2
  exit 69
}

timestamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
output_dir="${1:-midori-kanjo-business-data-${timestamp}}"
if [[ -e "${output_dir}" ]]; then
  echo "Refusing to overwrite existing path: ${output_dir}" >&2
  exit 73
fi
mkdir -m 700 -p "${output_dir}"

tables=(parties items party_item_prices invoices payments account_entries expenses)

for table in "${tables[@]}"; do
  psql "${SUPABASE_DB_URL}" \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --set=business_id="${MIDORI_BUSINESS_ID}" \
    --command="COPY (SELECT * FROM public.${table} WHERE business_id = :'business_id' ORDER BY id) TO STDOUT WITH (FORMAT CSV, HEADER TRUE)" \
    > "${output_dir}/${table}.csv"
done

(
  cd "${output_dir}"
  sha256sum ./*.csv > SHA256SUMS.txt
)

cat > "${output_dir}/SENSITIVE_DATA_MANIFEST.txt" <<EOF
MIDORI KANJO SENSITIVE BUSINESS DATA EXPORT
Generated (UTC): ${timestamp}
Source: one Supabase business_id, value deliberately omitted
Tables: ${tables[*]}

This directory contains customer, supplier, invoice, payment, expense,
inventory, negotiated-price and product-photo data. Encrypt it before moving
it off this computer. Never commit it to Git or upload it to a public service.

This cloud export is not a complete IndexedDB backup. Run
backup-tools/export-local-indexeddb.js on each authoritative app installation
to preserve local-only stores and device settings.
EOF

chmod 600 "${output_dir}"/*
echo "Sensitive export created at: ${output_dir}"
echo "Encrypt and store it separately from the source-code archive."
