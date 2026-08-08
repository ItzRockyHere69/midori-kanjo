-- Run this in the Supabase SQL editor. Enable anonymous sign-ins in Auth settings.
-- Every trusted device must use the same strong sync_code. RLS keeps other codes isolated.
create table if not exists public.parties (id text primary key, business_id text not null default (auth.jwt() -> 'user_metadata' ->> 'sync_code'), name text not null, code_name text default '', phone text default '', address text default '', gstin text, type text not null, price_tier text not null, opening_balance numeric default 0, current_balance numeric default 0, notes text default '', tags jsonb default '[]', created_at timestamptz not null, updated_at timestamptz not null);
alter table public.parties add column if not exists code_name text default '';
alter table public.parties add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
create index if not exists parties_code_name_idx on public.parties(code_name);
create table if not exists public.items (id text primary key, business_id text not null default (auth.jwt() -> 'user_metadata' ->> 'sync_code'), name text not null, name_hi text default '', name_bn text default '', sku_code text unique not null, category_id text, base_unit text not null, conversion_rate numeric default 1, purchase_price numeric default 0, price_retail numeric default 0, price_wholesale numeric default 0, price_bulk numeric default 0, current_stock numeric, low_stock_alert numeric, festival_tags jsonb default '[]', hsn_code text, gst_rate numeric default 0, image_url text, is_active boolean default true, sale_count integer default 0, last_sold_date date, created_at timestamptz not null, updated_at timestamptz not null);
alter table public.items add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
-- SKU and invoice numbers only need to be unique inside one business. The
-- earlier global unique constraints could make two unrelated businesses
-- collide when they used the same familiar SKU or invoice sequence.
alter table public.items drop constraint if exists items_sku_code_key;
create unique index if not exists items_business_sku_key on public.items (business_id, sku_code);
create table if not exists public.party_item_prices (id text primary key, business_id text not null default (auth.jwt() -> 'user_metadata' ->> 'sync_code'), party_id text not null references public.parties(id), item_id text not null references public.items(id), last_price numeric not null, last_sold_date date, times_sold integer default 0, locked_price boolean default false, updated_at timestamptz not null, unique(party_id,item_id));
alter table public.party_item_prices add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
create table if not exists public.invoices (id text primary key, business_id text not null default (auth.jwt() -> 'user_metadata' ->> 'sync_code'), invoice_number text unique not null, party_id text references public.parties(id), party_name text not null, party_gstin text, date date not null, type text not null, line_items jsonb not null, subtotal numeric not null, discount_total numeric default 0, gst_total numeric default 0, other_charges jsonb default '[]', other_charges_total numeric default 0, round_off numeric default 0, grand_total numeric not null, amount_paid numeric default 0, amount_due numeric default 0, payment_mode text not null, payment_received_mode text check (payment_received_mode in ('cash','upi','bank')), notes text default '', deleted_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null);
alter table public.invoices add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
alter table public.invoices drop constraint if exists invoices_invoice_number_key;
create unique index if not exists invoices_business_number_key on public.invoices (business_id, invoice_number);
alter table public.invoices add column if not exists party_gstin text;
alter table public.invoices add column if not exists other_charges jsonb default '[]';
alter table public.invoices add column if not exists other_charges_total numeric default 0;
create table if not exists public.payments (id text primary key, business_id text not null default (auth.jwt() -> 'user_metadata' ->> 'sync_code'), party_id text not null references public.parties(id), amount numeric not null, date date not null, mode text not null, reference text default '', allocated_to jsonb default '[]', created_at timestamptz not null, updated_at timestamptz not null);
alter table public.payments add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
create table if not exists public.account_entries (id text primary key, business_id text not null default (auth.jwt() -> 'user_metadata' ->> 'sync_code'), party_id text not null references public.parties(id), kind text not null default 'due', amount numeric not null, date date not null, note text default '', reference text default '', created_at timestamptz not null, updated_at timestamptz not null);
alter table public.account_entries add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
create table if not exists public.expenses (id text primary key, business_id text not null default (auth.jwt() -> 'user_metadata' ->> 'sync_code'), user_id uuid not null default auth.uid(), category text not null, amount numeric(14,2) not null check (amount > 0), date date not null, description text not null default '', payment_mode text not null check (payment_mode in ('cash','upi','bank')), reference text not null default '', deleted_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null);
alter table public.expenses add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
create index if not exists expenses_user_date_idx on public.expenses (user_id, date desc);

alter table public.parties enable row level security; alter table public.items enable row level security; alter table public.party_item_prices enable row level security; alter table public.invoices enable row level security; alter table public.payments enable row level security; alter table public.account_entries enable row level security; alter table public.expenses enable row level security;
drop policy if exists "authenticated parties" on public.parties;
drop policy if exists "authenticated items" on public.items;
drop policy if exists "authenticated prices" on public.party_item_prices;
drop policy if exists "authenticated invoices" on public.invoices;
drop policy if exists "authenticated payments" on public.payments;
drop policy if exists "authenticated account entries" on public.account_entries;
drop policy if exists "business parties" on public.parties;
drop policy if exists "business items" on public.items;
drop policy if exists "business prices" on public.party_item_prices;
drop policy if exists "business invoices" on public.invoices;
drop policy if exists "business payments" on public.payments;
drop policy if exists "business account entries" on public.account_entries;
drop policy if exists "business expenses" on public.expenses;
create policy "business parties" on public.parties for all to authenticated using (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20) with check (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20);
create policy "business items" on public.items for all to authenticated using (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20) with check (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20);
create policy "business prices" on public.party_item_prices for all to authenticated using (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20) with check (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20);
create policy "business invoices" on public.invoices for all to authenticated using (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20) with check (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20);
create policy "business payments" on public.payments for all to authenticated using (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20) with check (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20);
create policy "business account entries" on public.account_entries for all to authenticated using (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20) with check (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20);
create policy "business expenses" on public.expenses for all to authenticated using (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20) with check (business_id = (auth.jwt() -> 'user_metadata' ->> 'sync_code') and length(business_id) >= 20);
drop policy if exists "Users read their own expenses" on public.expenses;
drop policy if exists "Users add their own expenses" on public.expenses;
drop policy if exists "Users update their own expenses" on public.expenses;
drop policy if exists "Users delete their own expenses" on public.expenses;
