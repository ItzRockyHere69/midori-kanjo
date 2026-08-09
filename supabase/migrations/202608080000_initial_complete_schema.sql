-- Complete baseline for a brand-new Midori Kanjo Supabase project.
-- Anonymous sign-ins must also be enabled in the Supabase dashboard.

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

create table if not exists public.parties (
  business_id text not null default public.current_business_id(),
  id text not null,
  name text not null,
  code_name text default '',
  phone text default '',
  address text default '',
  gstin text,
  type text not null check (type in ('customer', 'supplier')),
  price_tier text not null,
  opening_balance numeric default 0,
  current_balance numeric default 0,
  notes text default '',
  tags jsonb default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id)
);

create table if not exists public.items (
  business_id text not null default public.current_business_id(),
  id text not null,
  name text not null,
  name_hi text default '',
  name_bn text default '',
  sku_code text not null,
  category_id text,
  base_unit text not null,
  conversion_rate numeric default 1,
  purchase_price numeric default 0,
  price_retail numeric default 0,
  price_wholesale numeric default 0,
  price_bulk numeric default 0,
  current_stock numeric,
  low_stock_alert numeric,
  festival_tags jsonb default '[]',
  hsn_code text,
  gst_rate numeric default 0,
  image_url text,
  is_active boolean default true,
  sale_count integer default 0,
  last_sold_date date,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  unique (business_id, sku_code)
);

create table if not exists public.party_item_prices (
  business_id text not null default public.current_business_id(),
  id text not null,
  party_id text not null,
  item_id text not null,
  last_price numeric not null,
  last_sold_date date,
  times_sold integer default 0,
  locked_price boolean default false,
  updated_at timestamptz not null,
  primary key (business_id, id),
  unique (business_id, party_id, item_id),
  foreign key (business_id, party_id)
    references public.parties (business_id, id),
  foreign key (business_id, item_id)
    references public.items (business_id, id)
);

create table if not exists public.invoices (
  business_id text not null default public.current_business_id(),
  id text not null,
  invoice_number text not null,
  party_id text,
  party_name text not null,
  party_gstin text,
  date date not null,
  type text not null,
  line_items jsonb not null,
  subtotal numeric not null,
  discount_total numeric default 0,
  gst_total numeric default 0,
  other_charges jsonb default '[]',
  other_charges_total numeric default 0,
  round_off numeric default 0,
  grand_total numeric not null,
  initial_amount_paid numeric not null default 0,
  amount_paid numeric default 0,
  amount_due numeric default 0,
  payment_mode text not null,
  payment_received_mode text check (payment_received_mode in ('cash', 'upi', 'bank', 'cheque')),
  payment_breakdown jsonb not null default '[]',
  notes text default '',
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  unique (business_id, invoice_number),
  foreign key (business_id, party_id)
    references public.parties (business_id, id)
);

create table if not exists public.payments (
  business_id text not null default public.current_business_id(),
  id text not null,
  party_id text not null,
  amount numeric not null check (amount > 0),
  date date not null,
  mode text not null check (mode in ('cash', 'upi', 'bank', 'cheque')),
  reference text default '',
  allocated_to jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, party_id)
    references public.parties (business_id, id)
);

create table if not exists public.account_entries (
  business_id text not null default public.current_business_id(),
  id text not null,
  party_id text not null,
  kind text not null default 'due',
  amount numeric not null check (amount > 0),
  date date not null,
  note text default '',
  reference text default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, party_id)
    references public.parties (business_id, id)
);

create table if not exists public.expenses (
  business_id text not null default public.current_business_id(),
  id text not null,
  user_id uuid not null default auth.uid(),
  category text not null,
  amount numeric(14, 2) not null check (amount > 0),
  date date not null,
  description text not null default '',
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'bank')),
  reference text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id)
);

create index if not exists parties_code_name_idx
  on public.parties (business_id, code_name);
create index if not exists expenses_user_date_idx
  on public.expenses (business_id, user_id, date desc);

alter table public.parties enable row level security;
alter table public.items enable row level security;
alter table public.party_item_prices enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.account_entries enable row level security;
alter table public.expenses enable row level security;

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
