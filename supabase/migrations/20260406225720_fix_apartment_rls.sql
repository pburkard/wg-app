-- Replace the restrictive SELECT policy with one that allows:
-- 1. Creators to read back the apartment they just inserted
-- 2. Users to look up apartments by invite_code when joining
-- Sensitive data (expenses, tasks, etc.) is protected by its own RLS.
drop policy if exists "Members can view their apartment" on public.apartments;
create policy "Authenticated users can view apartments"
  on public.apartments for select
  using (auth.uid() is not null);
