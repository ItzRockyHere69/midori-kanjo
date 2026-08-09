#!/usr/bin/env bash
set -euo pipefail

# Restores an export made by export-supabase-business-data.sh into an EMPTY
# Midori Kanjo schema and binds every row to a new private sync code.
umask 077

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the destination Postgres connection string.}"
: "${NEW_MIDORI_BUSINESS_ID:?Set NEW_MIDORI_BUSINESS_ID to the destination business sync code.}"

if [[ "${NEW_MIDORI_BUSINESS_ID}" == *$'\n'* || ${#NEW_MIDORI_BUSINESS_ID} -lt 20 ]]; then
  echo "NEW_MIDORI_BUSINESS_ID must be a single-line value of at least 20 characters." >&2
  exit 64
fi

command -v psql >/dev/null 2>&1 || {
  echo "psql is required. Install the PostgreSQL client tools first." >&2
  exit 69
}

data_dir="${1:-}"
if [[ -z "${data_dir}" || ! -d "${data_dir}" ]]; then
  echo "Usage: $0 /path/to/decrypted-business-data-export" >&2
  exit 64
fi

data_dir="$(cd "${data_dir}" && pwd)"
if [[ "${data_dir}" == *"'"* || "${data_dir}" == *$'\n'* ]]; then
  echo "The export path must not contain a quote or newline." >&2
  exit 64
fi

tables=(parties items party_item_prices invoices payments account_entries expenses)
for table in "${tables[@]}"; do
  [[ -f "${data_dir}/${table}.csv" ]] || {
    echo "Missing ${table}.csv in ${data_dir}" >&2
    exit 66
  }
done

if [[ -f "${data_dir}/SHA256SUMS.txt" ]]; then
  (cd "${data_dir}" && sha256sum --check SHA256SUMS.txt)
fi

existing_rows="$(psql "${SUPABASE_DB_URL}" --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="
  select
    (select count(*) from public.parties) +
    (select count(*) from public.items) +
    (select count(*) from public.party_item_prices) +
    (select count(*) from public.invoices) +
    (select count(*) from public.payments) +
    (select count(*) from public.account_entries) +
    (select count(*) from public.expenses);
")"
if [[ "${existing_rows//[[:space:]]/}" != "0" ]]; then
  echo "Destination application tables must be empty; restore was not started." >&2
  exit 65
fi

psql "${SUPABASE_DB_URL}" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --set=new_business_id="${NEW_MIDORI_BUSINESS_ID}" <<SQL
begin;

\copy public.parties from '${data_dir}/parties.csv' with (format csv, header true)
\copy public.items from '${data_dir}/items.csv' with (format csv, header true)
\copy public.party_item_prices from '${data_dir}/party_item_prices.csv' with (format csv, header true)
\copy public.invoices from '${data_dir}/invoices.csv' with (format csv, header true)
\copy public.payments from '${data_dir}/payments.csv' with (format csv, header true)
\copy public.account_entries from '${data_dir}/account_entries.csv' with (format csv, header true)
\copy public.expenses from '${data_dir}/expenses.csv' with (format csv, header true)

update public.parties set business_id = :'new_business_id';
update public.items set business_id = :'new_business_id';
update public.party_item_prices set business_id = :'new_business_id';
update public.invoices set business_id = :'new_business_id';
update public.payments set business_id = :'new_business_id';
update public.account_entries set business_id = :'new_business_id';
update public.expenses set business_id = :'new_business_id';

commit;
SQL

echo "Sensitive business data restored into the empty destination schema."
echo "Configure the app with the same NEW_MIDORI_BUSINESS_ID value, then sync."
