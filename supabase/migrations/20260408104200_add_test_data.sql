-- Add test data: completion history for apartment WTJ8D3
-- Populates existing apartment members with 12 weeks of completion history

DO $$
DECLARE
  apt_id UUID;
  member_ids UUID[];
  member_count INT;
  task_id UUID;
  selected_user UUID;
  days_back INT;
  insert_count INT := 0;
  i INT;
BEGIN
  -- Get apartment ID
  SELECT id INTO apt_id FROM public.apartments WHERE invite_code = 'WTJ8D3' LIMIT 1;

  IF apt_id IS NULL THEN
    RAISE NOTICE 'Apartment with invite code WTJ8D3 not found';
    RETURN;
  END IF;

  RAISE NOTICE 'Found apartment: %', apt_id;

  -- Get all members in this apartment
  SELECT ARRAY_AGG(id), COUNT(*) INTO member_ids, member_count
  FROM public.profiles
  WHERE apartment_id = apt_id;

  RAISE NOTICE 'Found % members: %', member_count, member_ids;

  IF member_count < 2 THEN
    RAISE NOTICE 'Not enough members (need at least 2) for test data';
    RETURN;
  END IF;

  -- Get existing tasks
  SELECT COUNT(*) INTO member_count FROM public.cleaning_tasks WHERE apartment_id = apt_id;
  RAISE NOTICE 'Found % cleaning tasks', member_count;

  IF member_count = 0 THEN
    RAISE NOTICE 'No cleaning tasks found. Need to create tasks first via the app.';
    RETURN;
  END IF;

  -- Clear old completion data for all members (fresh slate for test data)
  DELETE FROM public.cleaning_completions cc
  WHERE cc.task_id IN (SELECT id FROM public.cleaning_tasks WHERE apartment_id = apt_id);

  RAISE NOTICE 'Cleared all completion records';

  -- Add completion records for last 12 weeks (84 days)
  FOR task_id IN
    SELECT id FROM public.cleaning_tasks WHERE apartment_id = apt_id
  LOOP
    RAISE NOTICE 'Adding completions for task: %', task_id;
    FOR days_back IN 0..83 BY 7 LOOP
      -- Randomly select a member from the apartment
      IF random() < 0.85 THEN
        selected_user := member_ids[floor(random() * array_length(member_ids, 1))::int + 1];

        INSERT INTO public.cleaning_completions (task_id, completed_by, due_date, completed_at)
        VALUES (
          task_id,
          selected_user,
          (NOW()::date - days_back),
          (NOW() - (days_back || ' days')::interval)
        );
        insert_count := insert_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Test data complete: inserted % completion records for % members across % tasks',
    insert_count, member_count,
    (SELECT COUNT(*) FROM public.cleaning_tasks WHERE apartment_id = apt_id);
END $$;
