alter table public.invoices
  add column if not exists payment_received_mode text
  check (payment_received_mode in ('cash', 'upi', 'bank'));
