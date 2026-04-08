-- Allow users to delete their own completions (for undo)
create policy "Users can delete own completions"
  on public.cleaning_completions for delete
  using (completed_by = auth.uid());
