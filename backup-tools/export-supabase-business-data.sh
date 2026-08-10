#!/usr/bin/env bash
set -euo pipefail

# Produces the SENSITIVE cloud-data artifact. It never prints credentials or the
# business sync code. Run it locally; do not commit its output.
umask 077

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Postgres connection string.}"
: "${MIDORI_BUSINESS_ID:?Set MIDORI_BUSINESS_ID to the private business sync code.}"

if [[ "${MIDORI_BUSINESS_ID}" == *$'\n'* || "${MIDORI_BUSINESS_ID}" == *$'\r'* || ${#MIDORI_BUSINESS_ID} -lt 20 ]]; then
  echo "MIDORI_BUSINESS_ID must be a single-line value of at least 20 characters." >&2
  exit 64
fi

command -v psql >/dev/null 2>&1 || {
  echo "psql is required. Install the PostgreSQL client tools first." >&2
  exit 69
}

timestamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
output_dir="${1:-midori-kanjo-business-data-${timestamp}}"
if [[ -e "${output_dir}" || -L "${output_dir}" ]]; then
  echo "Refusing to overwrite existing path: ${output_dir}" >&2
  exit 73
fi

output_parent="$(dirname -- "${output_dir}")"
output_name="$(basename -- "${output_dir}")"
if [[ ! -d "${output_parent}" || "${output_name}" == "." || "${output_name}" == ".." ]]; then
  echo "The export parent directory must already exist." >&2
  exit 73
fi
output_parent="$(cd -- "${output_parent}" && pwd -P)"
output_dir="${output_parent}/${output_name}"
staging_dir="$(mktemp -d "${output_parent}/.${output_name}.tmp.XXXXXX")"

cleanup() {
  if [[ -n "${staging_dir:-}" && -d "${staging_dir}" ]]; then
    rm -rf -- "${staging_dir}"
  fi
}
trap cleanup EXIT HUP INT TERM

business_id="$(printf '%s' "${MIDORI_BUSINESS_ID}" | sha256sum | cut -d ' ' -f 1)"
export PGDATABASE="${SUPABASE_DB_URL}"
unset SUPABASE_DB_URL MIDORI_BUSINESS_ID

(
  cd -- "${staging_dir}"
  psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --set=business_id="${business_id}" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT set_config('midori.export_business_id', :'business_id', true);

SELECT EXISTS (
  SELECT 1 FROM public.categories WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.parties WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.items WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.party_item_prices WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.invoices WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.payments WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.account_entries WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.expenses WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.count_sessions WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.count_session_lines WHERE business_id = current_setting('midori.export_business_id')
  UNION ALL SELECT 1 FROM public.stock_movements WHERE business_id = current_setting('midori.export_business_id')
) AS tenant_has_rows \gset

\if :tenant_has_rows
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,name,parent_id,festival_season,created_at,updated_at FROM public.categories WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'categories.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,name,code_name,phone,address,gstin,type,price_tier,opening_balance,current_balance,notes,tags,created_at,updated_at FROM public.parties WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'parties.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,name,name_hi,name_bn,sku_code,category_id,base_unit,conversion_rate,purchase_price,price_retail,price_wholesale,price_bulk,current_stock,low_stock_alert,festival_tags,hsn_code,gst_rate,image_url,is_active,sale_count,last_sold_date,created_at,updated_at FROM public.items WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'items.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,party_id,item_id,last_price,last_sold_date,times_sold,locked_price,updated_at FROM public.party_item_prices WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'party_item_prices.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,invoice_number,party_id,party_name,party_gstin,date,type,line_items,subtotal,discount_total,gst_total,other_charges,other_charges_total,round_off,grand_total,initial_amount_paid,amount_paid,amount_due,payment_mode,payment_received_mode,payment_breakdown,return_details,notes,deleted_at,created_at,updated_at FROM public.invoices WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'invoices.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,party_id,amount,date,mode,reference,allocated_to,created_at,updated_at FROM public.payments WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'payments.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,party_id,kind,amount,date,note,reference,created_at,updated_at FROM public.account_entries WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'account_entries.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,user_id,category,amount,date,description,payment_mode,reference,deleted_at,created_at,updated_at FROM public.expenses WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'expenses.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,category_id,category_name,status,item_ids,started_at,completed_at,updated_at FROM public.count_sessions WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'count_sessions.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,session_id,item_id,item_name,sku_code,base_unit,system_stock_at_start,counted_stock,counted_at,created_at,updated_at FROM public.count_session_lines WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'count_session_lines.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy (SELECT current_setting('midori.export_business_id') AS business_id,id,item_id,kind,reason,note,qty_change,stock_before,stock_after,applied,entry_qty,entry_unit,pack_count,units_per_pack,contained_unit,ref_invoice_id,source_invoice_id,count_session_id,party_id,supplier_reference,date,actor,created_at,updated_at FROM public.stock_movements WHERE business_id = current_setting('midori.export_business_id') ORDER BY id) TO 'stock_movements.csv' WITH (FORMAT CSV, HEADER TRUE)
COMMIT;
\else
ROLLBACK;
\echo 'No rows were found for this business sync code.'
\quit 66
\endif
SQL
)

tables=(categories parties items party_item_prices invoices payments account_entries expenses count_sessions count_session_lines stock_movements)
cat > "${staging_dir}/SENSITIVE_DATA_MANIFEST.txt" <<EOF
MIDORI KANJO SENSITIVE BUSINESS DATA EXPORT
Format: midori-kanjo-supabase-business-data-v3
Generated (UTC): ${timestamp}
Source: one tenant derived from a private sync code; both values deliberately omitted
Tables: ${tables[*]}

This directory contains customer, supplier, invoice, payment, expense,
inventory, negotiated-price and product-photo data. Encrypt it before moving
it off this computer. Never commit it to Git or upload it to a public service.

This cloud export is not a complete IndexedDB backup. Run
backup-tools/export-local-indexeddb.js on each authoritative app installation
to preserve local-only stores and device settings.
EOF

(
  cd -- "${staging_dir}"
  sha256sum \
    categories.csv \
    parties.csv \
    items.csv \
    party_item_prices.csv \
    invoices.csv \
    payments.csv \
    account_entries.csv \
    expenses.csv \
    count_sessions.csv \
    count_session_lines.csv \
    stock_movements.csv \
    SENSITIVE_DATA_MANIFEST.txt > SHA256SUMS.txt
)
chmod 600 "${staging_dir}"/*
mv -- "${staging_dir}" "${output_dir}"
staging_dir=""
trap - EXIT HUP INT TERM

echo "Sensitive export created at: ${output_dir}"
echo "Encrypt and store it separately from the source-code archive."
