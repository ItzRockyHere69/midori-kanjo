create table if not exists public.expenses (
  id text primary key,
  user_id uuid not null default auth.uid(),
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  date date not null,
  description text not null default '',
  payment_mode text not null check (payment_mode in ('cash','upi','bank')),
  reference text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, date desc);

alter table public.expenses enable row level security;

drop policy if exists "Users read their own expenses" on public.expenses;
drop policy if exists "Users add their own expenses" on public.expenses;
drop policy if exists "Users update their own expenses" on public.expenses;
drop policy if exists "Users delete their own expenses" on public.expenses;
create policy "Users read their own expenses" on public.expenses for select using (auth.uid() = user_id);
create policy "Users add their own expenses" on public.expenses for insert with check (auth.uid() = user_id);
create policy "Users update their own expenses" on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete their own expenses" on public.expenses for delete using (auth.uid() = user_id);
