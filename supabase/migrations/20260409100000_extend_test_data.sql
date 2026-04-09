-- Extended test data for apartment WTJ8D3
-- Adds a 4th member and generates cleaning completions + expense history

-- 1. Add a new test user via auth admin (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'leia@test.com') THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_user_meta_data, confirmation_token
    )
    VALUES (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'leia@test.com',
      crypt('testtest', gen_salt('bf')),
      NOW(), NOW(), NOW(),
      '{"display_name": "Leia"}'::jsonb,
      ''
    );
    RAISE NOTICE 'Created user leia@test.com';
  ELSE
    RAISE NOTICE 'User leia@test.com already exists, skipping';
  END IF;
END $$;

-- Join the new user to the apartment (the trigger creates the profile row)
DO $$
DECLARE
  apt_id UUID;
  new_user_id UUID;
BEGIN
  SELECT id INTO apt_id FROM public.apartments WHERE invite_code = 'WTJ8D3' LIMIT 1;
  SELECT id INTO new_user_id FROM auth.users WHERE email = 'leia@test.com' LIMIT 1;

  IF apt_id IS NULL OR new_user_id IS NULL THEN
    RAISE NOTICE 'Apartment or user not found, skipping user setup';
    RETURN;
  END IF;

  UPDATE public.profiles
  SET apartment_id = apt_id, role = 'member'
  WHERE id = new_user_id;

  -- Add new user to all existing cleaning task rotation orders
  UPDATE public.cleaning_tasks
  SET rotation_order = rotation_order || ARRAY[new_user_id]::uuid[]
  WHERE apartment_id = apt_id
    AND NOT (new_user_id = ANY(rotation_order));

  RAISE NOTICE 'User Leia (%) joined apartment %', new_user_id, apt_id;
END $$;

-- 2. Regenerate cleaning completions with per-member personality
--    - Each member gets a different reliability rate
--    - Completions respect rotation: the assigned member usually does it
DO $$
DECLARE
  apt_id UUID;
  member_ids UUID[];
  member_count INT;
  tid UUID;
  week_offset INT;
  assigned_idx INT;
  assigned_user UUID;
  actual_user UUID;
  reliability FLOAT;
  reliabilities FLOAT[] := ARRAY[0.95, 0.82, 0.70, 0.60]; -- personality per member slot
  completion_date DATE;
  insert_count INT := 0;
  days_jitter INT;
BEGIN
  SELECT id INTO apt_id FROM public.apartments WHERE invite_code = 'WTJ8D3' LIMIT 1;
  IF apt_id IS NULL THEN RAISE NOTICE 'Apartment not found'; RETURN; END IF;

  SELECT ARRAY_AGG(id ORDER BY created_at), COUNT(*)
  INTO member_ids, member_count
  FROM public.profiles WHERE apartment_id = apt_id;

  IF member_count < 2 THEN RAISE NOTICE 'Not enough members'; RETURN; END IF;

  -- Clear old completions
  DELETE FROM public.cleaning_completions cc
  WHERE cc.task_id IN (SELECT id FROM public.cleaning_tasks WHERE apartment_id = apt_id);

  -- For each task, simulate 12 weeks of rotation-based completions
  FOR tid IN SELECT id FROM public.cleaning_tasks WHERE apartment_id = apt_id LOOP
    assigned_idx := 0;

    FOR week_offset IN REVERSE 11..0 LOOP
      -- Who was assigned this week (round-robin)
      assigned_user := member_ids[(assigned_idx % member_count) + 1];
      reliability := reliabilities[LEAST((assigned_idx % member_count) + 1, array_length(reliabilities, 1))];

      IF random() < reliability THEN
        -- Usually the assigned person does it
        IF random() < 0.85 THEN
          actual_user := assigned_user;
        ELSE
          -- Sometimes someone else helps out
          actual_user := member_ids[floor(random() * member_count)::int + 1];
        END IF;

        -- Completion date: due date +/- some jitter (good members do it early)
        completion_date := (CURRENT_DATE - (week_offset * 7));
        days_jitter := CASE
          WHEN reliability > 0.9 THEN floor(random() * 2)::int - 1  -- -1 to 0 days
          WHEN reliability > 0.7 THEN floor(random() * 3)::int       -- 0 to 2 days late
          ELSE floor(random() * 5)::int                               -- 0 to 4 days late
        END;
        completion_date := completion_date + days_jitter;

        INSERT INTO public.cleaning_completions (task_id, completed_by, due_date, completed_at)
        VALUES (
          tid,
          actual_user,
          CURRENT_DATE - (week_offset * 7),
          completion_date + TIME '10:00:00' + (random() * INTERVAL '8 hours')
        );
        insert_count := insert_count + 1;
      END IF;

      assigned_idx := assigned_idx + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Inserted % cleaning completions', insert_count;
END $$;

-- 3. Add expense history (last 12 weeks)
DO $$
DECLARE
  apt_id UUID;
  member_ids UUID[];
  member_count INT;
  payer UUID;
  exp_id UUID;
  week_offset INT;
  split_amount NUMERIC;
  i INT;
  expense_templates TEXT[][] := ARRAY[
    ARRAY['Groceries', 'groceries'],
    ARRAY['Toilet paper & supplies', 'groceries'],
    ARRAY['Internet bill', 'utilities'],
    ARRAY['Electricity', 'utilities'],
    ARRAY['Pizza night', 'food'],
    ARRAY['Cleaning supplies', 'groceries'],
    ARRAY['Netflix', 'entertainment'],
    ARRAY['Beer for party', 'food'],
    ARRAY['Light bulbs', 'other'],
    ARRAY['New trash bags', 'groceries']
  ];
  amounts NUMERIC[] := ARRAY[85.50, 12.90, 49.90, 120.00, 45.00, 24.50, 15.95, 32.00, 8.90, 6.50];
  tpl_idx INT;
  exp_date DATE;
  insert_count INT := 0;
BEGIN
  SELECT id INTO apt_id FROM public.apartments WHERE invite_code = 'WTJ8D3' LIMIT 1;
  IF apt_id IS NULL THEN RAISE NOTICE 'Apartment not found'; RETURN; END IF;

  SELECT ARRAY_AGG(id ORDER BY created_at), COUNT(*)
  INTO member_ids, member_count
  FROM public.profiles WHERE apartment_id = apt_id;

  IF member_count < 2 THEN RAISE NOTICE 'Not enough members'; RETURN; END IF;

  -- Clear old test expenses (keep any user-created ones by only deleting ones from test dates)
  -- We'll just add new ones; duplicates are fine for test data

  FOR week_offset IN REVERSE 11..0 LOOP
    -- Each week: 1-3 expenses
    FOR i IN 1..LEAST(1 + floor(random() * 3)::int, 3) LOOP
      tpl_idx := floor(random() * array_length(expense_templates, 1))::int + 1;
      payer := member_ids[floor(random() * member_count)::int + 1];
      exp_date := CURRENT_DATE - (week_offset * 7) + floor(random() * 7)::int;

      -- Vary the amount a bit (+/- 20%)
      INSERT INTO public.expenses (apartment_id, paid_by, amount, description, category, date, split_type)
      VALUES (
        apt_id,
        payer,
        ROUND((amounts[tpl_idx] * (0.8 + random() * 0.4))::numeric, 2),
        expense_templates[tpl_idx][1],
        expense_templates[tpl_idx][2],
        exp_date,
        'equal'
      )
      RETURNING id INTO exp_id;

      -- Equal split among all members
      split_amount := ROUND((amounts[tpl_idx] * (0.8 + random() * 0.4) / member_count)::numeric, 2);

      FOR i IN 1..member_count LOOP
        INSERT INTO public.expense_splits (expense_id, user_id, amount_owed, settled, settled_at)
        VALUES (
          exp_id,
          member_ids[i],
          split_amount,
          -- Older expenses are more likely to be settled
          CASE WHEN week_offset > 4 AND random() < 0.7 THEN true
               WHEN week_offset > 2 AND random() < 0.3 THEN true
               ELSE false
          END,
          CASE WHEN week_offset > 4 AND random() < 0.7
               THEN (CURRENT_DATE - (week_offset * 7) + floor(random() * 14)::int)::timestamptz
               WHEN week_offset > 2 AND random() < 0.3
               THEN (CURRENT_DATE - (week_offset * 7) + floor(random() * 14)::int)::timestamptz
               ELSE NULL
          END
        );
      END LOOP;

      insert_count := insert_count + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Inserted % expenses with splits', insert_count;
END $$;
