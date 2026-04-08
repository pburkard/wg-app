-- Helper function to get current user's apartment_id without triggering RLS
create or replace function public.get_my_apartment_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select apartment_id from public.profiles where id = auth.uid();
$$;

-- Fix profiles SELECT policy (was self-referencing → infinite recursion)
drop policy if exists "Users can view profiles in same apartment" on public.profiles;
create policy "Users can view profiles in same apartment"
  on public.profiles for select
  using (
    id = auth.uid()
    or (
      apartment_id is not null
      and apartment_id = public.get_my_apartment_id()
    )
  );

-- Fix all other policies that reference profiles for apartment_id lookup

-- Apartments (already fixed to allow all authenticated, no change needed)

-- Apartments update
drop policy if exists "Admin can update apartment" on public.apartments;
create policy "Admin can update apartment"
  on public.apartments for update
  using (
    id = public.get_my_apartment_id()
    and 'admin' = (select role from public.profiles where id = auth.uid())
  );

-- Cleaning tasks
drop policy if exists "Members can view cleaning tasks" on public.cleaning_tasks;
drop policy if exists "Members can manage cleaning tasks" on public.cleaning_tasks;
create policy "Members can view cleaning tasks"
  on public.cleaning_tasks for select
  using (apartment_id = public.get_my_apartment_id());

create policy "Members can manage cleaning tasks"
  on public.cleaning_tasks for all
  using (apartment_id = public.get_my_apartment_id());

-- Cleaning completions
drop policy if exists "Members can view completions" on public.cleaning_completions;
create policy "Members can view completions"
  on public.cleaning_completions for select
  using (
    task_id in (
      select id from public.cleaning_tasks
      where apartment_id = public.get_my_apartment_id()
    )
  );

-- Expenses
drop policy if exists "Members can view expenses" on public.expenses;
drop policy if exists "Members can create expenses" on public.expenses;
create policy "Members can view expenses"
  on public.expenses for select
  using (apartment_id = public.get_my_apartment_id());

create policy "Members can create expenses"
  on public.expenses for insert
  with check (
    apartment_id = public.get_my_apartment_id()
    and paid_by = auth.uid()
  );

-- Expense splits
drop policy if exists "Members can view expense splits" on public.expense_splits;
create policy "Members can view expense splits"
  on public.expense_splits for select
  using (
    expense_id in (
      select id from public.expenses
      where apartment_id = public.get_my_apartment_id()
    )
  );
