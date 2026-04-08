-- Allow all members to update apartment (name, address)
drop policy if exists "Admin can update apartment" on public.apartments;
create policy "Members can update apartment"
  on public.apartments for update
  using (id = public.get_my_apartment_id());
