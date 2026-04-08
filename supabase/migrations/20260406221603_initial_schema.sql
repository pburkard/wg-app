-- ============================================
-- WG Manager - Initial Schema
-- ============================================

-- 1. Apartments
create table public.apartments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  created_by uuid not null,
  invite_code text unique not null,
  created_at timestamptz default now()
);

-- 2. Profiles (extends auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  apartment_id uuid references public.apartments(id) on delete set null,
  role text check (role in ('admin', 'member')),
  push_token text,
  created_at timestamptz default now()
);

-- FK from apartments.created_by -> profiles.id
alter table public.apartments
  add constraint apartments_created_by_fkey
  foreign key (created_by) references public.profiles(id);

-- 3. Cleaning Tasks
create table public.cleaning_tasks (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  name text not null,
  frequency_days int not null default 7,
  rotation_order uuid[] not null default '{}',
  current_index int not null default 0,
  last_rotated_at timestamptz,
  created_at timestamptz default now()
);

-- 4. Cleaning Completions
create table public.cleaning_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.cleaning_tasks(id) on delete cascade,
  completed_by uuid not null references public.profiles(id),
  due_date date not null,
  completed_at timestamptz default now()
);

-- 5. Expenses
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  paid_by uuid not null references public.profiles(id),
  amount numeric not null,
  description text not null,
  category text not null default 'other',
  date date not null default current_date,
  split_type text not null default 'equal' check (split_type in ('equal', 'custom')),
  created_at timestamptz default now()
);

-- 6. Expense Splits
create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount_owed numeric not null,
  settled boolean not null default false,
  settled_at timestamptz
);

-- ============================================
-- Auto-create profile on signup
-- ============================================
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- Row Level Security
-- ============================================

-- Profiles
alter table public.profiles enable row level security;

create policy "Users can view profiles in same apartment"
  on public.profiles for select
  using (
    apartment_id is not null
    and apartment_id = (select apartment_id from public.profiles where id = auth.uid())
    or id = auth.uid()
  );

create policy "Users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Apartments
alter table public.apartments enable row level security;

create policy "Members can view their apartment"
  on public.apartments for select
  using (
    id = (select apartment_id from public.profiles where id = auth.uid())
  );

create policy "Authenticated users can create apartments"
  on public.apartments for insert
  with check (auth.uid() = created_by);

create policy "Admin can update apartment"
  on public.apartments for update
  using (
    id = (select apartment_id from public.profiles where id = auth.uid())
    and 'admin' = (select role from public.profiles where id = auth.uid())
  );

-- Cleaning Tasks
alter table public.cleaning_tasks enable row level security;

create policy "Members can view cleaning tasks"
  on public.cleaning_tasks for select
  using (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
  );

create policy "Members can manage cleaning tasks"
  on public.cleaning_tasks for all
  using (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
  );

-- Cleaning Completions
alter table public.cleaning_completions enable row level security;

create policy "Members can view completions"
  on public.cleaning_completions for select
  using (
    task_id in (
      select id from public.cleaning_tasks
      where apartment_id = (select apartment_id from public.profiles where id = auth.uid())
    )
  );

create policy "Members can insert completions"
  on public.cleaning_completions for insert
  with check (completed_by = auth.uid());

-- Expenses
alter table public.expenses enable row level security;

create policy "Members can view expenses"
  on public.expenses for select
  using (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
  );

create policy "Members can create expenses"
  on public.expenses for insert
  with check (
    apartment_id = (select apartment_id from public.profiles where id = auth.uid())
    and paid_by = auth.uid()
  );

-- Expense Splits
alter table public.expense_splits enable row level security;

create policy "Members can view expense splits"
  on public.expense_splits for select
  using (
    expense_id in (
      select id from public.expenses
      where apartment_id = (select apartment_id from public.profiles where id = auth.uid())
    )
  );

create policy "Users can settle own splits"
  on public.expense_splits for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
