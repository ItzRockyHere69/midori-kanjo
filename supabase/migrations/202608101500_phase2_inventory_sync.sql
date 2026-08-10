-- Phase 2 inventory audit trail, physical counts, and return settlements.

alter table public.invoices
  add column if not exists return_details jsonb;
update public.invoices set return_details = '{}'::jsonb
where return_details is null;
alter table public.invoices
  alter column return_details set default '{}'::jsonb,
  alter column return_details set not null;

create table if not exists public.categories (
  business_id text not null default public.current_business_id(),
  id text not null,
  name text not null,
  parent_id text,
  festival_season jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, parent_id)
    references public.categories (business_id, id)
);

create table if not exists public.count_sessions (
  business_id text not null default public.current_business_id(),
  id text not null,
  category_id text not null,
  category_name text not null,
  status text not null check (status in ('in_progress', 'completed')),
  item_ids jsonb not null default '[]',
  started_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, category_id)
    references public.categories (business_id, id)
);

create table if not exists public.count_session_lines (
  business_id text not null default public.current_business_id(),
  id text not null,
  session_id text not null,
  item_id text not null,
  item_name text not null,
  sku_code text not null,
  base_unit text not null,
  system_stock_at_start numeric,
  counted_stock numeric,
  counted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  unique (business_id, session_id, item_id),
  foreign key (business_id, session_id)
    references public.count_sessions (business_id, id),
  foreign key (business_id, item_id)
    references public.items (business_id, id)
);

create table if not exists public.stock_movements (
  business_id text not null default public.current_business_id(),
  id text not null,
  item_id text not null,
  kind text not null check (kind in ('baseline', 'sale', 'sale_void', 'sale_restore', 'inward', 'outward', 'sale_return', 'purchase_return', 'manual_adjustment', 'count_adjustment')),
  reason text not null,
  note text not null default '',
  qty_change numeric,
  stock_before numeric,
  stock_after numeric,
  applied boolean not null default false,
  entry_qty numeric,
  entry_unit text,
  pack_count numeric,
  units_per_pack numeric,
  contained_unit text,
  ref_invoice_id text,
  source_invoice_id text,
  count_session_id text,
  party_id text,
  supplier_reference text,
  date date not null,
  actor text not null check (actor in ('owner', 'staff')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, item_id) references public.items (business_id, id),
  foreign key (business_id, ref_invoice_id) references public.invoices (business_id, id),
  foreign key (business_id, source_invoice_id) references public.invoices (business_id, id),
  foreign key (business_id, count_session_id) references public.count_sessions (business_id, id),
  foreign key (business_id, party_id) references public.parties (business_id, id)
);

insert into public.stock_movements (
  business_id, id, item_id, kind, reason, note, qty_change,
  stock_before, stock_after, applied, date, actor, created_at, updated_at
)
select
  business_id,
  'baseline:' || id,
  id,
  'baseline',
  'phase2_baseline',
  'Opening tracked stock at Phase 2 upgrade',
  null,
  null,
  current_stock,
  true,
  ((updated_at + interval '1 millisecond') at time zone 'UTC')::date,
  'owner',
  updated_at + interval '1 millisecond',
  updated_at + interval '1 millisecond'
from public.items
where current_stock is not null
on conflict (business_id, id) do nothing;

create or replace function public.reject_stock_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'stock_movements are immutable audit records';
  end if;
  return new;
end
$$;
drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable
before update on public.stock_movements
for each row execute function public.reject_stock_movement_mutation();

create index if not exists categories_parent_idx
  on public.categories (business_id, parent_id);
create index if not exists count_sessions_status_idx
  on public.count_sessions (business_id, status, updated_at desc);
create index if not exists count_session_lines_session_idx
  on public.count_session_lines (business_id, session_id, updated_at);
create index if not exists stock_movements_item_date_idx
  on public.stock_movements (business_id, item_id, date desc, created_at desc);

alter table public.categories enable row level security;
alter table public.count_sessions enable row level security;
alter table public.count_session_lines enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "business categories" on public.categories;
drop policy if exists "business count sessions" on public.count_sessions;
drop policy if exists "business count session lines" on public.count_session_lines;
drop policy if exists "business stock movements" on public.stock_movements;

create policy "business categories" on public.categories for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business count sessions" on public.count_sessions for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business count session lines" on public.count_session_lines for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);
create policy "business stock movements" on public.stock_movements for all to authenticated
  using (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20)
  with check (business_id = public.current_business_id() and length(auth.jwt() -> 'user_metadata' ->> 'sync_code') >= 20);

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['categories', 'parties', 'items', 'party_item_prices', 'invoices', 'payments', 'account_entries', 'expenses', 'count_sessions', 'count_session_lines', 'stock_movements']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end
$$;
