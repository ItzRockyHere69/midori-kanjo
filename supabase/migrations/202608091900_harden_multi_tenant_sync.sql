-- Remove cross-business primary-key collisions, keep the raw sync credential
-- out of table rows, and persist the immutable payment made with each bill.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.current_business_id()
returns text
language sql
stable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      coalesce(auth.jwt() -> 'user_metadata' ->> 'sync_code', ''),
      'sha256'
    ),
    'hex'
  )
$$;

-- A legacy installation has a primary key on `id` alone. Hash its existing
-- raw business codes exactly once; a fresh baseline already has composite PKs.
do $$
declare
  legacy_schema boolean;
begin
  select not exists (
    select 1
    from pg_constraint constraint_row
    join lateral unnest(constraint_row.conkey) with ordinality key(attnum, ord)
      on true
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attnum = key.attnum
    where constraint_row.conrelid = 'public.parties'::regclass
      and constraint_row.contype = 'p'
    group by constraint_row.oid
    having array_agg(attribute_row.attname order by key.ord)
      = array['business_id', 'id']::name[]
  ) into legacy_schema;

  if legacy_schema then
    update public.parties set business_id = case
      when length(coalesce(business_id, '')) >= 20
        then encode(extensions.digest(business_id, 'sha256'), 'hex')
      else 'legacy-unassigned'
    end;
    update public.items set business_id = case
      when length(coalesce(business_id, '')) >= 20
        then encode(extensions.digest(business_id, 'sha256'), 'hex')
      else 'legacy-unassigned'
    end;
    update public.party_item_prices set business_id = case
      when length(coalesce(business_id, '')) >= 20
        then encode(extensions.digest(business_id, 'sha256'), 'hex')
      else 'legacy-unassigned'
    end;
    update public.invoices set business_id = case
      when length(coalesce(business_id, '')) >= 20
        then encode(extensions.digest(business_id, 'sha256'), 'hex')
      else 'legacy-unassigned'
    end;
    update public.payments set business_id = case
      when length(coalesce(business_id, '')) >= 20
        then encode(extensions.digest(business_id, 'sha256'), 'hex')
      else 'legacy-unassigned'
    end;
    update public.account_entries set business_id = case
      when length(coalesce(business_id, '')) >= 20
        then encode(extensions.digest(business_id, 'sha256'), 'hex')
      else 'legacy-unassigned'
    end;
    update public.expenses set business_id = case
      when length(coalesce(business_id, '')) >= 20
        then encode(extensions.digest(business_id, 'sha256'), 'hex')
      else 'legacy-unassigned'
    end;

    -- Pre-isolation databases could contain a null parent business while a
    -- later child row already carried the raw sync code. Recover a parent only
    -- when all of its visible child references identify one unambiguous tenant.
    with party_tenants as (
      select reference.party_id, min(reference.business_id) as business_id
      from (
        select business_id, party_id from public.party_item_prices
        union all select business_id, party_id from public.invoices
        union all select business_id, party_id from public.payments
        union all select business_id, party_id from public.account_entries
      ) reference
      where reference.party_id is not null
        and reference.business_id <> 'legacy-unassigned'
      group by reference.party_id
      having count(distinct reference.business_id) = 1
    )
    update public.parties parent
    set business_id = party_tenants.business_id
    from party_tenants
    where parent.id = party_tenants.party_id
      and parent.business_id = 'legacy-unassigned';

    with item_tenants as (
      select item_id, min(business_id) as business_id
      from public.party_item_prices
      where business_id <> 'legacy-unassigned'
      group by item_id
      having count(distinct business_id) = 1
    )
    update public.items parent
    set business_id = item_tenants.business_id
    from item_tenants
    where parent.id = item_tenants.item_id
      and parent.business_id = 'legacy-unassigned';

    update public.invoices child set business_id = parent.business_id
    from public.parties parent
    where child.business_id = 'legacy-unassigned'
      and child.party_id = parent.id
      and parent.business_id <> 'legacy-unassigned';
    update public.payments child set business_id = parent.business_id
    from public.parties parent
    where child.business_id = 'legacy-unassigned'
      and child.party_id = parent.id
      and parent.business_id <> 'legacy-unassigned';
    update public.account_entries child set business_id = parent.business_id
    from public.parties parent
    where child.business_id = 'legacy-unassigned'
      and child.party_id = parent.id
      and parent.business_id <> 'legacy-unassigned';
    update public.party_item_prices child set business_id = party.business_id
    from public.parties party, public.items item
    where child.business_id = 'legacy-unassigned'
      and child.party_id = party.id
      and child.item_id = item.id
      and party.business_id = item.business_id
      and party.business_id <> 'legacy-unassigned';
  end if;
end
$$;

alter table public.invoices add column if not exists initial_amount_paid numeric;
with allocations as (
  select
    payment.business_id,
    allocation.value ->> 'invoiceId' as invoice_id,
    sum(coalesce((allocation.value ->> 'amount')::numeric, 0)) as amount
  from public.payments payment
  cross join lateral jsonb_array_elements(
    coalesce(payment.allocated_to, '[]'::jsonb)
  ) allocation(value)
  group by payment.business_id, allocation.value ->> 'invoiceId'
)
update public.invoices invoice
set initial_amount_paid = greatest(
  0,
  least(
    invoice.grand_total,
    invoice.amount_paid - coalesce(allocations.amount, 0)
  )
)
from allocations
where invoice.business_id = allocations.business_id
  and invoice.id = allocations.invoice_id
  and invoice.initial_amount_paid is null;
update public.invoices
set initial_amount_paid = greatest(0, least(grand_total, amount_paid))
where initial_amount_paid is null;
alter table public.invoices alter column initial_amount_paid set default 0;
alter table public.invoices alter column initial_amount_paid set not null;

update public.payments set allocated_to = '[]'::jsonb
where allocated_to is null;
alter table public.payments alter column allocated_to set default '[]'::jsonb;
alter table public.payments alter column allocated_to set not null;

alter table public.party_item_prices drop constraint if exists party_item_prices_party_id_fkey;
alter table public.party_item_prices drop constraint if exists party_item_prices_item_id_fkey;
alter table public.invoices drop constraint if exists invoices_party_id_fkey;
alter table public.payments drop constraint if exists payments_party_id_fkey;
alter table public.account_entries drop constraint if exists account_entries_party_id_fkey;
alter table public.party_item_prices drop constraint if exists party_item_prices_business_id_party_id_fkey;
alter table public.party_item_prices drop constraint if exists party_item_prices_business_id_item_id_fkey;
alter table public.invoices drop constraint if exists invoices_business_id_party_id_fkey;
alter table public.payments drop constraint if exists payments_business_id_party_id_fkey;
alter table public.account_entries drop constraint if exists account_entries_business_id_party_id_fkey;

alter table public.party_item_prices drop constraint if exists party_item_prices_party_id_item_id_key;
alter table public.items drop constraint if exists items_sku_code_key;
alter table public.invoices drop constraint if exists invoices_invoice_number_key;
alter table public.party_item_prices drop constraint if exists party_item_prices_business_id_party_id_item_id_key;
alter table public.items drop constraint if exists items_business_id_sku_code_key;
alter table public.invoices drop constraint if exists invoices_business_id_invoice_number_key;

alter table public.parties drop constraint if exists parties_pkey;
alter table public.items drop constraint if exists items_pkey;
alter table public.party_item_prices drop constraint if exists party_item_prices_pkey;
alter table public.invoices drop constraint if exists invoices_pkey;
alter table public.payments drop constraint if exists payments_pkey;
alter table public.account_entries drop constraint if exists account_entries_pkey;
alter table public.expenses drop constraint if exists expenses_pkey;

alter table public.parties alter column business_id set default public.current_business_id();
alter table public.items alter column business_id set default public.current_business_id();
alter table public.party_item_prices alter column business_id set default public.current_business_id();
alter table public.invoices alter column business_id set default public.current_business_id();
alter table public.payments alter column business_id set default public.current_business_id();
alter table public.account_entries alter column business_id set default public.current_business_id();
alter table public.expenses alter column business_id set default public.current_business_id();

alter table public.parties alter column business_id set not null;
alter table public.items alter column business_id set not null;
alter table public.party_item_prices alter column business_id set not null;
alter table public.invoices alter column business_id set not null;
alter table public.payments alter column business_id set not null;
alter table public.account_entries alter column business_id set not null;
alter table public.expenses alter column business_id set not null;

alter table public.parties add primary key (business_id, id);
alter table public.items add primary key (business_id, id);
alter table public.party_item_prices add primary key (business_id, id);
alter table public.invoices add primary key (business_id, id);
alter table public.payments add primary key (business_id, id);
alter table public.account_entries add primary key (business_id, id);
alter table public.expenses add primary key (business_id, id);

drop index if exists public.items_business_sku_key;
drop index if exists public.invoices_business_number_key;
drop index if exists public.party_item_prices_business_pair_key;
create unique index items_business_sku_key
  on public.items (business_id, sku_code);
create unique index invoices_business_number_key
  on public.invoices (business_id, invoice_number);
create unique index party_item_prices_business_pair_key
  on public.party_item_prices (business_id, party_id, item_id);

alter table public.party_item_prices
  add constraint party_item_prices_business_id_party_id_fkey
  foreign key (business_id, party_id)
  references public.parties (business_id, id) not valid;
alter table public.party_item_prices
  add constraint party_item_prices_business_id_item_id_fkey
  foreign key (business_id, item_id)
  references public.items (business_id, id) not valid;
alter table public.invoices
  add constraint invoices_business_id_party_id_fkey
  foreign key (business_id, party_id)
  references public.parties (business_id, id) not valid;
alter table public.payments
  add constraint payments_business_id_party_id_fkey
  foreign key (business_id, party_id)
  references public.parties (business_id, id) not valid;
alter table public.account_entries
  add constraint account_entries_business_id_party_id_fkey
  foreign key (business_id, party_id)
  references public.parties (business_id, id) not valid;

-- NOT VALID preserves a security upgrade even if a rare pre-isolation orphan
-- remains. PostgreSQL still enforces each composite tenant FK for every new or
-- changed row; only the quarantined historical mismatch is left unvalidated.
do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('party_item_prices', 'party_item_prices_business_id_party_id_fkey'),
      ('party_item_prices', 'party_item_prices_business_id_item_id_fkey'),
      ('invoices', 'invoices_business_id_party_id_fkey'),
      ('payments', 'payments_business_id_party_id_fkey'),
      ('account_entries', 'account_entries_business_id_party_id_fkey')
    ) as constraints_to_validate(table_name, constraint_name)
  loop
    begin
      execute format(
        'alter table public.%I validate constraint %I',
        target.table_name,
        target.constraint_name
      );
    exception when foreign_key_violation then
      raise warning 'Left %.% unvalidated because quarantined legacy rows do not have a tenant-matched parent',
        target.table_name, target.constraint_name;
    end;
  end loop;
end
$$;

drop policy if exists "business parties" on public.parties;
drop policy if exists "business items" on public.items;
drop policy if exists "business prices" on public.party_item_prices;
drop policy if exists "business invoices" on public.invoices;
drop policy if exists "business payments" on public.payments;
drop policy if exists "business account entries" on public.account_entries;
drop policy if exists "business expenses" on public.expenses;

create policy "business parties" on public.parties for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business items" on public.items for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business prices" on public.party_item_prices for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business invoices" on public.invoices for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business payments" on public.payments for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business account entries" on public.account_entries for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business expenses" on public.expenses for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
