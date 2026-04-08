-- Allow any apartment member to delete recurring expenses (not just the creator)
drop policy if exists "Members can delete own recurring expenses" on public.recurring_expenses;
create policy "Members can delete recurring expenses"
  on public.recurring_expenses for delete
  using (apartment_id = public.get_my_apartment_id());

-- Also broaden update policy so any member can pause/edit
drop policy if exists "Members can update own recurring expenses" on public.recurring_expenses;
create policy "Members can update recurring expenses"
  on public.recurring_expenses for update
  using (apartment_id = public.get_my_apartment_id());
