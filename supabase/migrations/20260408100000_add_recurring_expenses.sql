-- Recurring expenses table
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  paid_by uuid not null references public.profiles(id),
  amount numeric not null,
  description text not null,
  category text not null default 'other',
  split_type text not null default 'equal' check (split_type in ('equal', 'custom')),
  custom_splits jsonb, -- { "user_id": amount, ... } for custom splits
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  next_due_date date not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Add recurring_expense_id to expenses so we can badge them
alter table public.expenses
  add column recurring_expense_id uuid references public.recurring_expenses(id) on delete set null;

-- RLS
alter table public.recurring_expenses enable row level security;

create policy "Members can view recurring expenses"
  on public.recurring_expenses for select
  using (apartment_id = public.get_my_apartment_id());

create policy "Members can create recurring expenses"
  on public.recurring_expenses for insert
  with check (
    apartment_id = public.get_my_apartment_id()
    and paid_by = auth.uid()
  );

create policy "Members can update own recurring expenses"
  on public.recurring_expenses for update
  using (paid_by = auth.uid());

create policy "Members can delete own recurring expenses"
  on public.recurring_expenses for delete
  using (paid_by = auth.uid());
