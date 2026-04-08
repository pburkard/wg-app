export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  apartment_id: string | null;
  role: 'admin' | 'member' | null;
  push_token: string | null;
  created_at: string;
};

export type Apartment = {
  id: string;
  name: string;
  address: string | null;
  created_by: string;
  invite_code: string;
  created_at: string;
};

export type CleaningTask = {
  id: string;
  apartment_id: string;
  name: string;
  frequency_days: number;
  rotation_order: string[];
  current_index: number;
  last_rotated_at: string;
  created_at: string;
};

export type CleaningCompletion = {
  id: string;
  task_id: string;
  completed_by: string;
  due_date: string;
  completed_at: string;
};

export type Expense = {
  id: string;
  apartment_id: string;
  paid_by: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  split_type: 'equal' | 'custom';
  recurring_expense_id: string | null;
  created_at: string;
};

export type RecurringExpense = {
  id: string;
  apartment_id: string;
  paid_by: string;
  amount: number;
  description: string;
  category: string;
  split_type: 'equal' | 'custom';
  custom_splits: Record<string, number> | null;
  frequency: 'weekly' | 'monthly' | 'yearly';
  due_day: number; // 0=last, 1-31 for monthly/yearly (clamped to last day if month is shorter), 1-7 (Mon-Sun) for weekly
  due_month: number | null; // 1-12, only for yearly
  next_due_date: string;
  active: boolean;
  created_at: string;
};

export type ExpenseSplit = {
  id: string;
  expense_id: string;
  user_id: string;
  amount_owed: number;
  settled: boolean;
  settled_at: string | null;
};
