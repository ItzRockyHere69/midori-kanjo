alter table public.invoices
  add column if not exists payment_breakdown jsonb;

update public.invoices
set payment_breakdown = '[]'::jsonb
where payment_breakdown is null;

alter table public.invoices
  alter column payment_breakdown set default '[]'::jsonb,
  alter column payment_breakdown set not null;

alter table public.invoices
  drop constraint if exists invoices_payment_received_mode_check;

alter table public.invoices
  add constraint invoices_payment_received_mode_check
  check (payment_received_mode is null or payment_received_mode in ('cash', 'upi', 'bank', 'cheque'));

alter table public.payments
  drop constraint if exists payments_mode_check;

alter table public.payments
  add constraint payments_mode_check
  check (mode in ('cash', 'upi', 'bank', 'cheque'));
