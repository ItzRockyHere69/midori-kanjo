#!/usr/bin/env bash
set -euo pipefail

# Restores an export made by export-supabase-business-data.sh into an EMPTY
# Midori Kanjo schema and binds every row to a new private sync code.
umask 077

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the destination Postgres connection string.}"
: "${NEW_MIDORI_BUSINESS_ID:?Set NEW_MIDORI_BUSINESS_ID to the destination business sync code.}"

if [[ "${NEW_MIDORI_BUSINESS_ID}" == *$'\n'* || "${NEW_MIDORI_BUSINESS_ID}" == *$'\r'* || ${#NEW_MIDORI_BUSINESS_ID} -lt 20 ]]; then
  echo "NEW_MIDORI_BUSINESS_ID must be a single-line value of at least 20 characters." >&2
  exit 64
fi

command -v psql >/dev/null 2>&1 || {
  echo "psql is required. Install the PostgreSQL client tools first." >&2
  exit 69
}

data_dir="${1:-}"
if [[ -z "${data_dir}" || ! -d "${data_dir}" || -L "${data_dir}" ]]; then
  echo "Usage: $0 /path/to/decrypted-business-data-export" >&2
  exit 64
fi
data_dir="$(cd -- "${data_dir}" && pwd -P)"

tables=(categories parties items party_item_prices invoices payments account_entries expenses count_sessions count_session_lines stock_movements)
csv_files=(
  categories.csv
  parties.csv
  items.csv
  party_item_prices.csv
  invoices.csv
  payments.csv
  account_entries.csv
  expenses.csv
  count_sessions.csv
  count_session_lines.csv
  stock_movements.csv
)
checked_files=("${csv_files[@]}" SENSITIVE_DATA_MANIFEST.txt)

for file in "${checked_files[@]}" SHA256SUMS.txt; do
  if [[ ! -f "${data_dir}/${file}" || -L "${data_dir}/${file}" ]]; then
    echo "Missing or unsafe ${file} in ${data_dir}" >&2
    exit 66
  fi
done

checksum_lines=()
while IFS= read -r line || [[ -n "${line}" ]]; do
  checksum_lines+=("${line}")
done < "${data_dir}/SHA256SUMS.txt"

if [[ ${#checksum_lines[@]} -ne ${#checked_files[@]} ]]; then
  echo "SHA256SUMS.txt must cover each required artifact exactly once." >&2
  exit 66
fi
for index in "${!checked_files[@]}"; do
  expected="${checked_files[index]}"
  line="${checksum_lines[index]}"
  hash="${line:0:64}"
  separator="${line:64:2}"
  file="${line:66}"
  if [[ ! "${hash}" =~ ^[0-9a-f]{64}$ || "${separator}" != "  " || ! "${file}" =~ ^[A-Za-z0-9._-]+$ || "${file}" != "${expected}" ]]; then
    echo "SHA256SUMS.txt must cover each required artifact exactly once." >&2
    exit 66
  fi
done

(
  cd -- "${data_dir}"
  sha256sum --check --strict SHA256SUMS.txt >/dev/null
) || {
  echo "The backup checksum verification failed." >&2
  exit 66
}

expected_headers=(
  'business_id,id,name,parent_id,festival_season,created_at,updated_at'
  'business_id,id,name,code_name,phone,address,gstin,type,price_tier,opening_balance,current_balance,notes,tags,created_at,updated_at'
  'business_id,id,name,name_hi,name_bn,sku_code,category_id,base_unit,conversion_rate,purchase_price,price_retail,price_wholesale,price_bulk,current_stock,low_stock_alert,festival_tags,hsn_code,gst_rate,image_url,is_active,sale_count,last_sold_date,created_at,updated_at'
  'business_id,id,party_id,item_id,last_price,last_sold_date,times_sold,locked_price,updated_at'
  'business_id,id,invoice_number,party_id,party_name,party_gstin,date,type,line_items,subtotal,discount_total,gst_total,other_charges,other_charges_total,round_off,grand_total,initial_amount_paid,amount_paid,amount_due,payment_mode,payment_received_mode,payment_breakdown,return_details,notes,deleted_at,created_at,updated_at'
  'business_id,id,party_id,amount,date,mode,reference,allocated_to,created_at,updated_at'
  'business_id,id,party_id,kind,amount,date,note,reference,created_at,updated_at'
  'business_id,id,user_id,category,amount,date,description,payment_mode,reference,deleted_at,created_at,updated_at'
  'business_id,id,category_id,category_name,status,item_ids,started_at,completed_at,updated_at'
  'business_id,id,session_id,item_id,item_name,sku_code,base_unit,system_stock_at_start,counted_stock,counted_at,created_at,updated_at'
  'business_id,id,item_id,kind,reason,note,qty_change,stock_before,stock_after,applied,entry_qty,entry_unit,pack_count,units_per_pack,contained_unit,ref_invoice_id,source_invoice_id,count_session_id,party_id,supplier_reference,date,actor,created_at,updated_at'
)
for index in "${!csv_files[@]}"; do
  file="${csv_files[index]}"
  IFS= read -r header < "${data_dir}/${file}" || true
  if [[ "${header}" != "${expected_headers[index]}" ]]; then
    echo "Unexpected CSV header in ${file}; the backup schema does not match this app version." >&2
    exit 66
  fi
done

if ! grep -Fxq 'Format: midori-kanjo-supabase-business-data-v3' "${data_dir}/SENSITIVE_DATA_MANIFEST.txt"; then
  echo "The backup manifest format is unsupported." >&2
  exit 66
fi

new_business_id="$(printf '%s' "${NEW_MIDORI_BUSINESS_ID}" | sha256sum | cut -d ' ' -f 1)"
export PGDATABASE="${SUPABASE_DB_URL}"
unset SUPABASE_DB_URL NEW_MIDORI_BUSINESS_ID

(
  cd -- "${data_dir}"
  psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --set=new_business_id="${new_business_id}" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT set_config('midori.restore_business_id', :'new_business_id', true);

LOCK TABLE
  public.categories,
  public.parties,
  public.items,
  public.party_item_prices,
  public.invoices,
  public.payments,
  public.account_entries,
  public.expenses,
  public.count_sessions,
  public.count_session_lines,
  public.stock_movements
IN SHARE ROW EXCLUSIVE MODE;

SELECT (
  (SELECT count(*) FROM public.categories) +
  (SELECT count(*) FROM public.parties) +
  (SELECT count(*) FROM public.items) +
  (SELECT count(*) FROM public.party_item_prices) +
  (SELECT count(*) FROM public.invoices) +
  (SELECT count(*) FROM public.payments) +
  (SELECT count(*) FROM public.account_entries) +
  (SELECT count(*) FROM public.expenses) +
  (SELECT count(*) FROM public.count_sessions) +
  (SELECT count(*) FROM public.count_session_lines) +
  (SELECT count(*) FROM public.stock_movements)
) = 0 AS destination_empty \gset

\if :destination_empty
CREATE TEMP TABLE restore_categories (LIKE public.categories INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_parties (LIKE public.parties INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_items (LIKE public.items INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_party_item_prices (LIKE public.party_item_prices INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_invoices (LIKE public.invoices INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_payments (LIKE public.payments INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_account_entries (LIKE public.account_entries INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_expenses (LIKE public.expenses INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_count_sessions (LIKE public.count_sessions INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_count_session_lines (LIKE public.count_session_lines INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE restore_stock_movements (LIKE public.stock_movements INCLUDING DEFAULTS) ON COMMIT DROP;

\copy pg_temp.restore_categories (business_id,id,name,parent_id,festival_season,created_at,updated_at) FROM 'categories.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_parties (business_id,id,name,code_name,phone,address,gstin,type,price_tier,opening_balance,current_balance,notes,tags,created_at,updated_at) FROM 'parties.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_items (business_id,id,name,name_hi,name_bn,sku_code,category_id,base_unit,conversion_rate,purchase_price,price_retail,price_wholesale,price_bulk,current_stock,low_stock_alert,festival_tags,hsn_code,gst_rate,image_url,is_active,sale_count,last_sold_date,created_at,updated_at) FROM 'items.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_party_item_prices (business_id,id,party_id,item_id,last_price,last_sold_date,times_sold,locked_price,updated_at) FROM 'party_item_prices.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_invoices (business_id,id,invoice_number,party_id,party_name,party_gstin,date,type,line_items,subtotal,discount_total,gst_total,other_charges,other_charges_total,round_off,grand_total,initial_amount_paid,amount_paid,amount_due,payment_mode,payment_received_mode,payment_breakdown,return_details,notes,deleted_at,created_at,updated_at) FROM 'invoices.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_payments (business_id,id,party_id,amount,date,mode,reference,allocated_to,created_at,updated_at) FROM 'payments.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_account_entries (business_id,id,party_id,kind,amount,date,note,reference,created_at,updated_at) FROM 'account_entries.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_expenses (business_id,id,user_id,category,amount,date,description,payment_mode,reference,deleted_at,created_at,updated_at) FROM 'expenses.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_count_sessions (business_id,id,category_id,category_name,status,item_ids,started_at,completed_at,updated_at) FROM 'count_sessions.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_count_session_lines (business_id,id,session_id,item_id,item_name,sku_code,base_unit,system_stock_at_start,counted_stock,counted_at,created_at,updated_at) FROM 'count_session_lines.csv' WITH (FORMAT CSV, HEADER TRUE)
\copy pg_temp.restore_stock_movements (business_id,id,item_id,kind,reason,note,qty_change,stock_before,stock_after,applied,entry_qty,entry_unit,pack_count,units_per_pack,contained_unit,ref_invoice_id,source_invoice_id,count_session_id,party_id,supplier_reference,date,actor,created_at,updated_at) FROM 'stock_movements.csv' WITH (FORMAT CSV, HEADER TRUE)

SELECT count(DISTINCT business_id) = 1 AS source_single_tenant
FROM (
  SELECT business_id FROM pg_temp.restore_categories
  UNION ALL SELECT business_id FROM pg_temp.restore_parties
  UNION ALL SELECT business_id FROM pg_temp.restore_items
  UNION ALL SELECT business_id FROM pg_temp.restore_party_item_prices
  UNION ALL SELECT business_id FROM pg_temp.restore_invoices
  UNION ALL SELECT business_id FROM pg_temp.restore_payments
  UNION ALL SELECT business_id FROM pg_temp.restore_account_entries
  UNION ALL SELECT business_id FROM pg_temp.restore_expenses
  UNION ALL SELECT business_id FROM pg_temp.restore_count_sessions
  UNION ALL SELECT business_id FROM pg_temp.restore_count_session_lines
  UNION ALL SELECT business_id FROM pg_temp.restore_stock_movements
) source_rows \gset

\if :source_single_tenant
INSERT INTO public.categories (business_id,id,name,parent_id,festival_season,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,name,parent_id,festival_season,created_at,updated_at FROM pg_temp.restore_categories;
INSERT INTO public.parties (business_id,id,name,code_name,phone,address,gstin,type,price_tier,opening_balance,current_balance,notes,tags,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,name,code_name,phone,address,gstin,type,price_tier,opening_balance,current_balance,notes,tags,created_at,updated_at FROM pg_temp.restore_parties;
INSERT INTO public.items (business_id,id,name,name_hi,name_bn,sku_code,category_id,base_unit,conversion_rate,purchase_price,price_retail,price_wholesale,price_bulk,current_stock,low_stock_alert,festival_tags,hsn_code,gst_rate,image_url,is_active,sale_count,last_sold_date,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,name,name_hi,name_bn,sku_code,category_id,base_unit,conversion_rate,purchase_price,price_retail,price_wholesale,price_bulk,current_stock,low_stock_alert,festival_tags,hsn_code,gst_rate,image_url,is_active,sale_count,last_sold_date,created_at,updated_at FROM pg_temp.restore_items;
INSERT INTO public.party_item_prices (business_id,id,party_id,item_id,last_price,last_sold_date,times_sold,locked_price,updated_at) SELECT current_setting('midori.restore_business_id'),id,party_id,item_id,last_price,last_sold_date,times_sold,locked_price,updated_at FROM pg_temp.restore_party_item_prices;
INSERT INTO public.invoices (business_id,id,invoice_number,party_id,party_name,party_gstin,date,type,line_items,subtotal,discount_total,gst_total,other_charges,other_charges_total,round_off,grand_total,initial_amount_paid,amount_paid,amount_due,payment_mode,payment_received_mode,payment_breakdown,return_details,notes,deleted_at,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,invoice_number,party_id,party_name,party_gstin,date,type,line_items,subtotal,discount_total,gst_total,other_charges,other_charges_total,round_off,grand_total,initial_amount_paid,amount_paid,amount_due,payment_mode,payment_received_mode,payment_breakdown,return_details,notes,deleted_at,created_at,updated_at FROM pg_temp.restore_invoices;
INSERT INTO public.payments (business_id,id,party_id,amount,date,mode,reference,allocated_to,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,party_id,amount,date,mode,reference,allocated_to,created_at,updated_at FROM pg_temp.restore_payments;
INSERT INTO public.account_entries (business_id,id,party_id,kind,amount,date,note,reference,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,party_id,kind,amount,date,note,reference,created_at,updated_at FROM pg_temp.restore_account_entries;
INSERT INTO public.expenses (business_id,id,user_id,category,amount,date,description,payment_mode,reference,deleted_at,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,user_id,category,amount,date,description,payment_mode,reference,deleted_at,created_at,updated_at FROM pg_temp.restore_expenses;
INSERT INTO public.count_sessions (business_id,id,category_id,category_name,status,item_ids,started_at,completed_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,category_id,category_name,status,item_ids,started_at,completed_at,updated_at FROM pg_temp.restore_count_sessions;
INSERT INTO public.count_session_lines (business_id,id,session_id,item_id,item_name,sku_code,base_unit,system_stock_at_start,counted_stock,counted_at,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,session_id,item_id,item_name,sku_code,base_unit,system_stock_at_start,counted_stock,counted_at,created_at,updated_at FROM pg_temp.restore_count_session_lines;
INSERT INTO public.stock_movements (business_id,id,item_id,kind,reason,note,qty_change,stock_before,stock_after,applied,entry_qty,entry_unit,pack_count,units_per_pack,contained_unit,ref_invoice_id,source_invoice_id,count_session_id,party_id,supplier_reference,date,actor,created_at,updated_at) SELECT current_setting('midori.restore_business_id'),id,item_id,kind,reason,note,qty_change,stock_before,stock_after,applied,entry_qty,entry_unit,pack_count,units_per_pack,contained_unit,ref_invoice_id,source_invoice_id,count_session_id,party_id,supplier_reference,date,actor,created_at,updated_at FROM pg_temp.restore_stock_movements;

SELECT (
  (SELECT count(*) FROM public.categories) = (SELECT count(*) FROM pg_temp.restore_categories) AND
  (SELECT count(*) FROM public.parties) = (SELECT count(*) FROM pg_temp.restore_parties) AND
  (SELECT count(*) FROM public.items) = (SELECT count(*) FROM pg_temp.restore_items) AND
  (SELECT count(*) FROM public.party_item_prices) = (SELECT count(*) FROM pg_temp.restore_party_item_prices) AND
  (SELECT count(*) FROM public.invoices) = (SELECT count(*) FROM pg_temp.restore_invoices) AND
  (SELECT count(*) FROM public.payments) = (SELECT count(*) FROM pg_temp.restore_payments) AND
  (SELECT count(*) FROM public.account_entries) = (SELECT count(*) FROM pg_temp.restore_account_entries) AND
  (SELECT count(*) FROM public.expenses) = (SELECT count(*) FROM pg_temp.restore_expenses) AND
  (SELECT count(*) FROM public.count_sessions) = (SELECT count(*) FROM pg_temp.restore_count_sessions) AND
  (SELECT count(*) FROM public.count_session_lines) = (SELECT count(*) FROM pg_temp.restore_count_session_lines) AND
  (SELECT count(*) FROM public.stock_movements) = (SELECT count(*) FROM pg_temp.restore_stock_movements)
) AS counts_match \gset

\if :counts_match
COMMIT;
\else
ROLLBACK;
\echo 'Restore row-count verification failed.'
\quit 65
\endif
\else
ROLLBACK;
\echo 'The archive contains rows from more than one business.'
\quit 66
\endif
\else
ROLLBACK;
\echo 'Destination application tables must be empty; restore was not started.'
\quit 65
\endif
SQL
)

echo "Sensitive business data restored into the empty destination schema."
echo "Configure the app with the same NEW_MIDORI_BUSINESS_ID value, then sync."
