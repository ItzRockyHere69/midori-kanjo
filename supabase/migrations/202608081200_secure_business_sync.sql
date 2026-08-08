-- Isolate each Midori Kanjo business by a strong sync code stored in the
-- anonymous user's JWT metadata. Run this after the earlier schema changes.
-- Existing remote rows with a null business_id remain deliberately hidden;
-- export/re-import them under the chosen code instead of exposing them.

alter table public.parties add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
alter table public.items add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
alter table public.party_item_prices add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
alter table public.invoices add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
alter table public.payments add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
alter table public.account_entries add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');
alter table public.expenses add column if not exists business_id text default (auth.jwt() -> 'user_metadata' ->> 'sync_code');

drop policy if exists "authenticated parties" on public.parties;
drop policy if exists "authenticated items" on public.items;
drop policy if exists "authenticated prices" on public.party_item_prices;
drop policy if exists "authenticated invoices" on public.invoices;
drop policy if exists "authenticated payments" on public.payments;
drop policy if exists "authenticated account entries" on public.account_entries;
drop policy if exists "Users read their own expenses" on public.expenses;
drop policy if exists "Users add their own expenses" on public.expenses;
drop policy if exists "Users update their own expenses" on public.expenses;
drop policy if exists "Users delete their own expenses" on public.expenses;

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
