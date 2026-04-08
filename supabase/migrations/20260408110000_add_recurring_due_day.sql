-- Add due day fields to recurring expenses
-- due_day: day of month (1-28) or day of week (1=Mon..7=Sun), 0 = last day. Default 0 (last).
-- due_month: month (1-12), only used for yearly frequency. Null otherwise. Default 12 (December).
alter table public.recurring_expenses
  add column due_day int not null default 0,
  add column due_month int;
