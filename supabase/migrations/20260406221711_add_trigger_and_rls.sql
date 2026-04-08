-- Auto-create profile on signup (idempotent)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', 'User')
  );
  return new;
end;
$$;

-- Drop trigger if exists, then recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- Row Level Security (idempotent with IF NOT EXISTS workaround)
-- ============================================

-- Profiles
alter table public.profiles enable row level security;

drop policy if exists "Users can view profiles in same apartment" on public.profiles;
create policy "Users can view profiles in same apartment"
  on public.profiles for select
  using (
    (apartment_id is not null
    and apartment_id = (select apartment_id from public.profiles where id = auth.uid()))
    or id = auth.uid()
  );

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Apartments
alter table public.apartments enable row level security;

drop policy if exists "Members can view their apartment" on public.apartments;
create policy "Members can view their apartment"
  on public.apartments for select
  using (
    id = (select apartment_id from public.profiles where id = auth.uid())
  );

drop policy if exists "Authenticated users can create apartments" on public.apartments;
create policy "Authenticated users can create apartments"
  on public.apartments for insert
  with check (auth.uid() = created_by);

drop policy if exists "Admin can update apartment" on public.apartments;
create policy "Admin can update apartment"
  on public.apartments for update
  using (
    id = (select apartment_id from public.profiles where id = auth.uid())
    and 'admin' = (select role from public.profiles where id = auth.uid())
  );

-- Cleaning Tasks
alter table public.cleaning_tasks enable row level security;

drop policy if exists "Members can view cleaning tasks" on public.cleaning_tasks;
create policy "Members can view cleaning tasks"
  on public.cleaning_tasks for select
  using (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
  );

drop policy if exists "Members can manage cleaning tasks" on public.cleaning_tasks;
create policy "Members can manage cleaning tasks"
  on public.cleaning_tasks for all
  using (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
  );

-- Cleaning Completions
alter table public.cleaning_completions enable row level security;

drop policy if exists "Members can view completions" on public.cleaning_completions;
create policy "Members can view completions"
  on public.cleaning_completions for select
  using (
    task_id in (
      select id from public.cleaning_tasks
      where apartment_id = (select apartment_id from public.profiles where id = auth.uid())
    )
  );

drop policy if exists "Members can insert completions" on public.cleaning_completions;
create policy "Members can insert completions"
  on public.cleaning_completions for insert
  with check (completed_by = auth.uid());

-- Expenses
alter table public.expenses enable row level security;

drop policy if exists "Members can view expenses" on public.expenses;
create policy "Members can view expenses"
  on public.expenses for select
  using (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
  );

drop policy if exists "Members can create expenses" on public.expenses;
create policy "Members can create expenses"
  on public.expenses for insert
  with check (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
    and paid_by = auth.uid()
  );

-- Expense Splits
alter table public.expense_splits enable row level security;

drop policy if exists "Members can view expense splits" on public.expense_splits;
create policy "Members can view expense splits"
  on public.expense_splits for select
  using (
    expense_id in (
      select id from public.expenses
      where apartment_id = (select apartment_id from public.profiles where id = auth.uid())
    )
  );

drop policy if exists "Users can settle own splits" on public.expense_splits;
create policy "Users can settle own splits"
  on public.expense_splits for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
