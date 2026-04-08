import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  Switch,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { confirmAction } from '../../lib/confirm';
import { notifyApartmentMembers } from '../../lib/notifications';
import { useAuth } from '../../contexts/AuthContext';
import { Expense, Profile, RecurringExpense } from '../../types/database';

type ExpenseWithPayer = Expense & { payer_name: string };
type Balance = { userId: string; name: string; net: number };
type Debt = { from: string; fromName: string; to: string; toName: string; amount: number };

export default function FinancesScreen() {
  const { profile, user } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseWithPayer[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [editingRecId, setEditingRecId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('other');
  const [editFrequency, setEditFrequency] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [editDueDay, setEditDueDay] = useState(0);
  const [editDueMonth, setEditDueMonth] = useState(12);
  const [editLoading, setEditLoading] = useState(false);

  // Add form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('other');
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [customSplits, setCustomSplits] = useState<Map<string, string>>(new Map());
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [dueDay, setDueDay] = useState(0); // 0 = last day
  const [dueMonth, setDueMonth] = useState(12); // 1-12, for yearly
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!profile?.apartment_id) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('apartment_id', profile.apartment_id);
    if (data) setMembers(data as Profile[]);
  }, [profile?.apartment_id]);

  const fetchExpenses = useCallback(async () => {
    if (!profile?.apartment_id || members.length === 0) return;
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .eq('apartment_id', profile.apartment_id)
      .order('date', { ascending: false })
      .limit(50);
    if (data) {
      const mapped = (data as Expense[]).map((e) => ({
        ...e,
        payer_name: members.find((m) => m.id === e.paid_by)?.display_name ?? 'Unknown',
      }));
      setExpenses(mapped);
    }
  }, [profile?.apartment_id, members]);

  const fetchBalances = useCallback(async () => {
    if (!profile?.apartment_id || members.length === 0) return;

    const { data: splits } = await supabase
      .from('expense_splits')
      .select('user_id, amount_owed, expense_id')
      .eq('settled', false);

    const { data: expenseRows } = await supabase
      .from('expenses')
      .select('id, paid_by')
      .eq('apartment_id', profile.apartment_id);

    if (!splits || !expenseRows) return;

    const paidByMap = new Map<string, string>();
    for (const e of expenseRows) paidByMap.set(e.id, e.paid_by);
    const apartmentExpenseIds = new Set(expenseRows.map((e) => e.id));

    const nets = new Map<string, number>();
    members.forEach((m) => nets.set(m.id, 0));

    for (const split of splits) {
      if (!apartmentExpenseIds.has(split.expense_id)) continue;
      const payer = paidByMap.get(split.expense_id)!;
      const debtor = split.user_id as string;
      const amt = Number(split.amount_owed);

      if (payer !== debtor) {
        nets.set(payer, (nets.get(payer) ?? 0) + amt);
        nets.set(debtor, (nets.get(debtor) ?? 0) - amt);
      }
    }

    setBalances(
      members.map((m) => ({
        userId: m.id,
        name: m.display_name,
        net: nets.get(m.id) ?? 0,
      })),
    );

    const simplified = simplifyDebts(members, nets);
    setDebts(simplified);
  }, [profile?.apartment_id, members]);

  const fetchRecurring = useCallback(async () => {
    if (!profile?.apartment_id) return;
    const { data } = await supabase
      .from('recurring_expenses')
      .select('*')
      .eq('apartment_id', profile.apartment_id)
      .order('created_at', { ascending: false });
    if (data) setRecurringExpenses(data as RecurringExpense[]);
  }, [profile?.apartment_id]);

  function simplifyDebts(memberList: Profile[], nets: Map<string, number>): Debt[] {
    const creditors: { id: string; name: string; amount: number }[] = [];
    const debtorsList: { id: string; name: string; amount: number }[] = [];

    for (const m of memberList) {
      const net = nets.get(m.id) ?? 0;
      if (net > 0.01) creditors.push({ id: m.id, name: m.display_name, amount: net });
      else if (net < -0.01) debtorsList.push({ id: m.id, name: m.display_name, amount: -net });
    }

    creditors.sort((a, b) => b.amount - a.amount);
    debtorsList.sort((a, b) => b.amount - a.amount);

    const result: Debt[] = [];
    let i = 0;
    let j = 0;

    while (i < debtorsList.length && j < creditors.length) {
      const transfer = Math.min(debtorsList[i].amount, creditors[j].amount);
      if (transfer > 0.01) {
        result.push({
          from: debtorsList[i].id,
          fromName: debtorsList[i].name,
          to: creditors[j].id,
          toName: creditors[j].name,
          amount: Math.round(transfer * 100) / 100,
        });
      }
      debtorsList[i].amount -= transfer;
      creditors[j].amount -= transfer;
      if (debtorsList[i].amount < 0.01) i++;
      if (creditors[j].amount < 0.01) j++;
    }

    return result;
  }

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    if (members.length > 0) {
      fetchExpenses();
      fetchBalances();
      fetchRecurring();
    }
  }, [members, fetchExpenses, fetchBalances, fetchRecurring]);

  function resetAddForm() {
    setDescription('');
    setAmount('');
    setCategory('other');
    setSplitType('equal');
    setCustomSplits(new Map());
    setIsRecurring(false);
    setFrequency('monthly');
    setDueDay(0);
    setDueMonth(12);
    setShowAdd(false);
  }

  async function handleAddExpense() {
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid description and amount.');
      return;
    }

    if (splitType === 'custom') {
      let totalCustom = 0;
      for (const m of members) {
        const val = parseFloat(customSplits.get(m.id) ?? '0');
        if (isNaN(val) || val < 0) {
          Alert.alert('Error', `Invalid amount for ${m.display_name}.`);
          return;
        }
        totalCustom += val;
      }
      if (Math.abs(totalCustom - parsedAmount) > 0.02) {
        Alert.alert(
          'Error',
          `Custom splits (CHF ${totalCustom.toFixed(2)}) don't add up to total (CHF ${parsedAmount.toFixed(2)}).`,
        );
        return;
      }
    }

    setLoading(true);

    if (isRecurring) {
      // Create recurring expense
      const customSplitsObj: Record<string, number> | null =
        splitType === 'custom'
          ? Object.fromEntries(
              members.map((m) => [m.id, Math.round(parseFloat(customSplits.get(m.id) ?? '0') * 100) / 100]),
            )
          : null;

      const nextDueDate = computeNextDueDate(frequency, dueDay, dueMonth);

      const { error } = await supabase.from('recurring_expenses').insert({
        apartment_id: profile!.apartment_id,
        paid_by: user!.id,
        amount: parsedAmount,
        description: description.trim(),
        category,
        split_type: splitType,
        custom_splits: customSplitsObj,
        frequency,
        due_day: dueDay,
        due_month: frequency === 'yearly' ? dueMonth : null,
        next_due_date: nextDueDate,
      });

      setLoading(false);
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      resetAddForm();
      fetchRecurring();
      Alert.alert('Recurring expense created', `First charge on ${nextDueDate}, then ${frequency}.`);
      return;
    }

    // One-time expense
    const { data: expense, error: expError } = await supabase
      .from('expenses')
      .insert({
        apartment_id: profile!.apartment_id,
        paid_by: user!.id,
        amount: parsedAmount,
        description: description.trim(),
        category,
        date: new Date().toISOString().split('T')[0],
        split_type: splitType,
      })
      .select()
      .single();

    if (expError || !expense) {
      setLoading(false);
      Alert.alert('Error', expError?.message ?? 'Failed to create expense.');
      return;
    }

    let splits;
    if (splitType === 'equal') {
      const splitAmount = Math.round((parsedAmount / members.length) * 100) / 100;
      splits = members.map((m) => ({
        expense_id: expense.id,
        user_id: m.id,
        amount_owed: splitAmount,
      }));
    } else {
      splits = members.map((m) => ({
        expense_id: expense.id,
        user_id: m.id,
        amount_owed: Math.round(parseFloat(customSplits.get(m.id) ?? '0') * 100) / 100,
      }));
    }

    const { error: splitError } = await supabase
      .from('expense_splits')
      .insert(splits);

    setLoading(false);

    if (splitError) {
      Alert.alert('Error', splitError.message);
      return;
    }

    resetAddForm();
    fetchExpenses();
    fetchBalances();

    notifyApartmentMembers(
      profile!.apartment_id!,
      user!.id,
      'New Expense',
      `${profile!.display_name} added ${description.trim()} for CHF ${parsedAmount.toFixed(2)}`,
    ).catch(() => {});
  }

  function handleSettle(debt: Debt) {
    confirmAction(
      'Settle Debt',
      `Mark CHF ${debt.amount.toFixed(2)} from ${debt.fromName} to ${debt.toName} as settled?`,
      async () => {
        const { data: expenseRows } = await supabase
          .from('expenses')
          .select('id')
          .eq('apartment_id', profile!.apartment_id)
          .eq('paid_by', debt.to);

        if (!expenseRows) return;

        const expenseIds = expenseRows.map((e) => e.id);
        if (expenseIds.length === 0) return;

        const { error } = await supabase
          .from('expense_splits')
          .update({ settled: true, settled_at: new Date().toISOString() })
          .eq('user_id', debt.from)
          .eq('settled', false)
          .in('expense_id', expenseIds);

        if (error) {
          Alert.alert('Error', error.message);
          return;
        }

        fetchBalances();

        const { data: creditorProfile } = await supabase
          .from('profiles')
          .select('push_token')
          .eq('id', debt.to)
          .single();

        if (creditorProfile?.push_token) {
          const { sendPushNotification } = await import('../../lib/notifications');
          sendPushNotification(
            creditorProfile.push_token,
            'Debt Settled',
            `${debt.fromName} settled CHF ${debt.amount.toFixed(2)}`,
          ).catch(() => {});
        }
      },
      'Settle',
    );
  }

  async function handleToggleRecurring(rec: RecurringExpense) {
    const newActive = !rec.active;
    const { error } = await supabase
      .from('recurring_expenses')
      .update({ active: newActive })
      .eq('id', rec.id);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    fetchRecurring();
  }

  function handleDeleteRecurring(rec: RecurringExpense) {
    confirmAction(
      'Delete Recurring Expense',
      `Delete "${rec.description}"? Past expenses will remain.`,
      async () => {
        const { error } = await supabase
          .from('recurring_expenses')
          .delete()
          .eq('id', rec.id);
        if (error) Alert.alert('Delete failed', error.message);
        else fetchRecurring();
      },
      'Delete',
      true,
    );
  }

  function startEditRecurring(rec: RecurringExpense) {
    setEditingRecId(rec.id);
    setEditDesc(rec.description);
    setEditAmount(String(rec.amount));
    setEditCategory(rec.category);
    setEditFrequency(rec.frequency);
    setEditDueDay(rec.due_day);
    setEditDueMonth(rec.due_month ?? 12);
  }

  function cancelEditRecurring() {
    setEditingRecId(null);
  }

  async function handleSaveRecurring() {
    if (!editingRecId) return;
    const parsedAmount = parseFloat(editAmount);
    if (!editDesc.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid description and amount.');
      return;
    }

    setEditLoading(true);
    const nextDueDate = computeNextDueDate(editFrequency, editDueDay, editDueMonth);

    const { error } = await supabase
      .from('recurring_expenses')
      .update({
        description: editDesc.trim(),
        amount: parsedAmount,
        category: editCategory,
        frequency: editFrequency,
        due_day: editDueDay,
        due_month: editFrequency === 'yearly' ? editDueMonth : null,
        next_due_date: nextDueDate,
      })
      .eq('id', editingRecId);

    setEditLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setEditingRecId(null);
    fetchRecurring();
  }

  function getMyBalance(): number {
    return balances.find((b) => b.userId === user?.id)?.net ?? 0;
  }

  function getMyDebts(): Debt[] {
    return debts.filter((d) => d.from === user?.id || d.to === user?.id);
  }

  function formatFrequency(f: string) {
    return f === 'weekly' ? 'Weekly' : f === 'monthly' ? 'Monthly' : 'Yearly';
  }

  function computeNextDueDate(freq: string, day: number, month: number): string {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (freq === 'weekly') {
      // day: 1=Mon..7=Sun, 0=Sun (last day = 7)
      const targetDow = day === 0 ? 7 : day; // 1=Mon..7=Sun
      const currentDow = now.getDay() === 0 ? 7 : now.getDay();
      let diff = targetDow - currentDow;
      if (diff <= 0) diff += 7;
      const next = new Date(now);
      next.setDate(next.getDate() + diff);
      return next.toISOString().split('T')[0];
    }

    if (freq === 'monthly') {
      const y = now.getFullYear();
      const m = now.getMonth(); // 0-indexed
      // Try this month first
      const lastDayThisMonth = new Date(y, m + 1, 0).getDate();
      const targetDay = day === 0 ? lastDayThisMonth : Math.min(day, lastDayThisMonth);
      const candidate = `${y}-${String(m + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
      if (candidate >= todayStr) return candidate;
      // Next month
      const nm = m + 1;
      const ny = y + (nm > 11 ? 1 : 0);
      const actualMonth = nm % 12;
      const lastDayNext = new Date(ny, actualMonth + 1, 0).getDate();
      const d = day === 0 ? lastDayNext : Math.min(day, lastDayNext);
      return `${ny}-${String(actualMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    // yearly
    const y = now.getFullYear();
    const targetMonth = (month || 12) - 1; // 0-indexed
    const lastDay = new Date(y, targetMonth + 1, 0).getDate();
    const targetDay = day === 0 ? lastDay : Math.min(day, lastDay);
    const candidate = `${y}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    if (candidate >= todayStr) return candidate;
    // Next year
    const ny = y + 1;
    const ld = new Date(ny, targetMonth + 1, 0).getDate();
    const d = day === 0 ? ld : Math.min(day, ld);
    return `${ny}-${String(targetMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function getDayOptions(freq: string) {
    if (freq === 'weekly') {
      return [
        { value: 0, label: 'Last day (Sun)' },
        ...WEEKDAYS.map((d, i) => ({ value: i + 1, label: d })),
      ];
    }
    if (freq === 'monthly') {
      return [
        { value: 0, label: 'Last day' },
        ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
      ];
    }
    // yearly - day of month
    return [
      { value: 0, label: 'Last day' },
      ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    ];
  }

  function formatDueDay(freq: string, day: number, month: number | null): string {
    if (freq === 'weekly') {
      return day === 0 ? 'Sunday' : WEEKDAYS[day - 1];
    }
    if (freq === 'monthly') {
      return day === 0 ? 'Last day' : `Day ${day}`;
    }
    const m = MONTHS[(month ?? 12) - 1];
    return day === 0 ? `Last day of ${m}` : `${m} ${day}`;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Finances</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setShowRecurring(true)}>
            <Text style={styles.recurringButton}>Recurring</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowAdd(true)}>
            <Text style={styles.addButton}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            {/* Balance summary */}
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Your balance</Text>
              <Text
                style={[
                  styles.balanceAmount,
                  getMyBalance() > 0
                    ? styles.positive
                    : getMyBalance() < 0
                    ? styles.negative
                    : styles.neutral,
                ]}
              >
                CHF {getMyBalance().toFixed(2)}
              </Text>
              <Text style={styles.balanceHint}>
                {members.length <= 1
                  ? 'Add more members to split expenses'
                  : getMyBalance() > 0
                  ? 'Others owe you'
                  : getMyBalance() < 0
                  ? 'You owe others'
                  : 'All settled up'}
              </Text>
            </View>

            {/* Simplified debts */}
            {getMyDebts().length > 0 && (
              <View style={styles.debtsSection}>
                <Text style={styles.sectionTitle}>Outstanding</Text>
                {getMyDebts().map((d, i) => {
                  const iOwe = d.from === user?.id;
                  return (
                    <View key={i} style={styles.debtRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.debtText}>
                          {iOwe
                            ? `You owe ${d.toName}`
                            : `${d.fromName} owes you`}
                        </Text>
                        <Text style={[styles.debtAmount, iOwe ? styles.negative : styles.positive]}>
                          CHF {d.amount.toFixed(2)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.settleButton}
                        onPress={() => handleSettle(d)}
                      >
                        <Text style={styles.settleButtonText}>Settle</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {expenses.length > 0 && (
              <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Recent Expenses</Text>
            )}
          </>
        }
        ListEmptyComponent={
          <Text style={styles.placeholder}>No expenses yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.expenseRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.expenseDescRow}>
                <Text style={styles.expenseDesc}>{item.description}</Text>
                {item.recurring_expense_id && (
                  <View style={styles.recurringBadge}>
                    <Text style={styles.recurringBadgeText}>recurring</Text>
                  </View>
                )}
              </View>
              <Text style={styles.expenseMeta}>
                {item.payer_name} · {item.date} · {item.category}
              </Text>
            </View>
            <Text style={styles.expenseAmount}>
              CHF {Number(item.amount).toFixed(2)}
            </Text>
          </View>
        )}
      />

      {/* Add Expense Modal */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalTitle}>New Expense</Text>

            <TextInput
              style={styles.input}
              placeholder="Description (e.g. Weekly groceries)"
              value={description}
              onChangeText={setDescription}
              placeholderTextColor="#999"
            />

            <TextInput
              style={styles.input}
              placeholder="Amount (CHF)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholderTextColor="#999"
            />

            <View style={styles.categoryRow}>
              {['groceries', 'utilities', 'other'].map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryChip,
                    category === cat && styles.categoryChipActive,
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      category === cat && styles.categoryTextActive,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Split type toggle */}
            <Text style={styles.splitLabel}>Split</Text>
            <View style={styles.splitToggle}>
              <TouchableOpacity
                style={[styles.splitOption, splitType === 'equal' && styles.splitOptionActive]}
                onPress={() => setSplitType('equal')}
              >
                <Text style={[styles.splitOptionText, splitType === 'equal' && styles.splitOptionTextActive]}>
                  Equal
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.splitOption, splitType === 'custom' && styles.splitOptionActive]}
                onPress={() => {
                  setSplitType('custom');
                  const parsedAmount = parseFloat(amount) || 0;
                  const perPerson = (parsedAmount / members.length).toFixed(2);
                  const map = new Map<string, string>();
                  members.forEach((m) => map.set(m.id, perPerson));
                  setCustomSplits(map);
                }}
              >
                <Text style={[styles.splitOptionText, splitType === 'custom' && styles.splitOptionTextActive]}>
                  Custom
                </Text>
              </TouchableOpacity>
            </View>

            {splitType === 'custom' && members.map((m) => (
              <View key={m.id} style={styles.customSplitRow}>
                <Text style={styles.customSplitName}>{m.display_name}</Text>
                <TextInput
                  style={styles.customSplitInput}
                  value={customSplits.get(m.id) ?? ''}
                  onChangeText={(val) => {
                    const newMap = new Map(customSplits);
                    newMap.set(m.id, val);
                    setCustomSplits(newMap);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#999"
                />
              </View>
            ))}

            {splitType === 'custom' && (
              <Text style={styles.customSplitTotal}>
                Total: CHF{' '}
                {members
                  .reduce((sum, m) => sum + (parseFloat(customSplits.get(m.id) ?? '0') || 0), 0)
                  .toFixed(2)}{' '}
                / CHF {(parseFloat(amount) || 0).toFixed(2)}
              </Text>
            )}

            {/* Recurring toggle */}
            <View style={styles.recurringToggleRow}>
              <View>
                <Text style={styles.recurringToggleLabel}>Recurring</Text>
                <Text style={styles.recurringToggleHint}>For subscriptions & regular bills</Text>
              </View>
              <Switch
                value={isRecurring}
                onValueChange={setIsRecurring}
                trackColor={{ false: '#ddd', true: '#c7d2fe' }}
                thumbColor={isRecurring ? '#4f46e5' : '#f4f4f5'}
              />
            </View>

            {isRecurring && (
              <>
                <View style={styles.frequencyRow}>
                  {(['weekly', 'monthly', 'yearly'] as const).map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[styles.frequencyChip, frequency === f && styles.frequencyChipActive]}
                      onPress={() => {
                        setFrequency(f);
                        setDueDay(0); // reset to last day
                        setDueMonth(12);
                      }}
                    >
                      <Text style={[styles.frequencyText, frequency === f && styles.frequencyTextActive]}>
                        {formatFrequency(f)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Yearly: month picker */}
                {frequency === 'yearly' && (
                  <>
                    <Text style={styles.dueDayLabel}>Month</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dueDayScroll}>
                      {MONTHS.map((m, i) => (
                        <TouchableOpacity
                          key={m}
                          style={[styles.dueDayChip, dueMonth === i + 1 && styles.dueDayChipActive]}
                          onPress={() => setDueMonth(i + 1)}
                        >
                          <Text style={[styles.dueDayChipText, dueMonth === i + 1 && styles.dueDayChipTextActive]}>
                            {m}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                {/* Day picker */}
                <Text style={styles.dueDayLabel}>
                  {frequency === 'weekly' ? 'Day of week' : 'Day of month'}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dueDayScroll}>
                  {getDayOptions(frequency).map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.dueDayChip, dueDay === opt.value && styles.dueDayChipActive]}
                      onPress={() => setDueDay(opt.value)}
                    >
                      <Text style={[styles.dueDayChipText, dueDay === opt.value && styles.dueDayChipTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleAddExpense}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Adding...' : isRecurring ? 'Create Recurring' : 'Add Expense'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={resetAddForm}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Manage Recurring Modal */}
      <Modal visible={showRecurring} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
          >
            <Text style={styles.modalTitle}>Recurring Expenses</Text>

            {recurringExpenses.length === 0 ? (
              <Text style={styles.placeholder}>
                No recurring expenses yet. Add one via "+ Add".
              </Text>
            ) : (
              recurringExpenses.map((rec) => {
                const payerName = members.find((m) => m.id === rec.paid_by)?.display_name ?? 'Unknown';
                const isEditing = editingRecId === rec.id;

                if (isEditing) {
                  return (
                    <View key={rec.id} style={styles.editRecurringCard}>
                      <TextInput
                        style={styles.editRecInput}
                        value={editDesc}
                        onChangeText={setEditDesc}
                        placeholder="Description"
                        placeholderTextColor="#999"
                      />
                      <TextInput
                        style={styles.editRecInput}
                        value={editAmount}
                        onChangeText={setEditAmount}
                        placeholder="Amount (CHF)"
                        keyboardType="decimal-pad"
                        placeholderTextColor="#999"
                      />
                      <View style={styles.categoryRow}>
                        {['groceries', 'utilities', 'other'].map((cat) => (
                          <TouchableOpacity
                            key={cat}
                            style={[styles.categoryChip, editCategory === cat && styles.categoryChipActive]}
                            onPress={() => setEditCategory(cat)}
                          >
                            <Text style={[styles.categoryText, editCategory === cat && styles.categoryTextActive]}>
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.frequencyRow}>
                        {(['weekly', 'monthly', 'yearly'] as const).map((f) => (
                          <TouchableOpacity
                            key={f}
                            style={[styles.frequencyChip, editFrequency === f && styles.frequencyChipActive]}
                            onPress={() => {
                              setEditFrequency(f);
                              setEditDueDay(0);
                              setEditDueMonth(12);
                            }}
                          >
                            <Text style={[styles.frequencyText, editFrequency === f && styles.frequencyTextActive]}>
                              {formatFrequency(f)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {editFrequency === 'yearly' && (
                        <>
                          <Text style={styles.dueDayLabel}>Month</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dueDayScroll}>
                            {MONTHS.map((m, i) => (
                              <TouchableOpacity
                                key={m}
                                style={[styles.dueDayChip, editDueMonth === i + 1 && styles.dueDayChipActive]}
                                onPress={() => setEditDueMonth(i + 1)}
                              >
                                <Text style={[styles.dueDayChipText, editDueMonth === i + 1 && styles.dueDayChipTextActive]}>
                                  {m}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </>
                      )}
                      <Text style={styles.dueDayLabel}>
                        {editFrequency === 'weekly' ? 'Day of week' : 'Day of month'}
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dueDayScroll}>
                        {getDayOptions(editFrequency).map((opt) => (
                          <TouchableOpacity
                            key={opt.value}
                            style={[styles.dueDayChip, editDueDay === opt.value && styles.dueDayChipActive]}
                            onPress={() => setEditDueDay(opt.value)}
                          >
                            <Text style={[styles.dueDayChipText, editDueDay === opt.value && styles.dueDayChipTextActive]}>
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                      <View style={styles.editRecButtons}>
                        <TouchableOpacity
                          style={[styles.editRecSave, editLoading && styles.buttonDisabled]}
                          onPress={handleSaveRecurring}
                          disabled={editLoading}
                        >
                          <Text style={styles.editRecSaveText}>{editLoading ? 'Saving...' : 'Save'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={cancelEditRecurring}>
                          <Text style={styles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={rec.id} style={[styles.recurringCard, !rec.active && styles.recurringCardInactive]}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => startEditRecurring(rec)}>
                      <Text style={[styles.recurringName, !rec.active && styles.recurringNameInactive]}>
                        {rec.description}
                      </Text>
                      <Text style={styles.recurringMeta}>
                        CHF {Number(rec.amount).toFixed(2)} · {formatFrequency(rec.frequency)} · {formatDueDay(rec.frequency, rec.due_day, rec.due_month)} · {payerName}
                      </Text>
                      <Text style={styles.recurringMeta}>
                        Next: {rec.active ? rec.next_due_date : 'Paused'}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.recurringActions}>
                      <TouchableOpacity onPress={() => startEditRecurring(rec)}>
                        <Text style={styles.recurringActionText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleToggleRecurring(rec)}>
                        <Text style={styles.recurringActionText}>
                          {rec.active ? 'Pause' : 'Resume'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDeleteRecurring(rec)}>
                        <Text style={styles.recurringDeleteText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowRecurring(false)}
            >
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
    paddingTop: Platform.OS === 'web' ? 60 : 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  addButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4f46e5',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  recurringButton: {
    fontSize: 14,
    fontWeight: '500',
    color: '#999',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  balanceCard: {
    backgroundColor: '#f5f3ff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: '700',
  },
  balanceHint: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  positive: { color: '#16a34a' },
  negative: { color: '#ef4444' },
  neutral: { color: '#666' },
  debtsSection: { marginBottom: 16 },
  debtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  debtText: { fontSize: 15, color: '#1a1a1a' },
  debtAmount: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  settleButton: {
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginLeft: 12,
  },
  settleButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  placeholder: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    marginTop: 32,
  },
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  expenseDescRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  expenseDesc: { fontSize: 16, color: '#1a1a1a', fontWeight: '500' },
  recurringBadge: {
    backgroundColor: '#ede9fe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recurringBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#7c3aed',
    textTransform: 'uppercase',
  },
  expenseMeta: { fontSize: 13, color: '#999', marginTop: 2 },
  expenseAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 12,
    marginRight: 15,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalScroll: {
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalContent: { padding: 24, paddingBottom: 40 },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: '#f9f9f9',
    color: '#1a1a1a',
  },
  categoryRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  categoryChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  categoryChipActive: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  categoryText: { fontSize: 14, color: '#666' },
  categoryTextActive: { color: '#fff' },
  splitLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  splitToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 16,
  },
  splitOption: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  splitOptionActive: { backgroundColor: '#4f46e5' },
  splitOptionText: { fontSize: 15, fontWeight: '600', color: '#666' },
  splitOptionTextActive: { color: '#fff' },
  customSplitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  customSplitName: { fontSize: 15, color: '#1a1a1a', flex: 1 },
  customSplitInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    width: 100,
    textAlign: 'right',
    backgroundColor: '#f9f9f9',
    color: '#1a1a1a',
  },
  customSplitTotal: {
    fontSize: 13,
    color: '#999',
    textAlign: 'right',
    marginBottom: 16,
  },
  // Recurring toggle
  recurringToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  recurringToggleLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  recurringToggleHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  frequencyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  frequencyChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  frequencyChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  frequencyText: { fontSize: 14, color: '#666', fontWeight: '500' },
  frequencyTextActive: { color: '#fff' },
  dueDayLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 4,
  },
  dueDayScroll: {
    marginBottom: 16,
  },
  dueDayChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 6,
  },
  dueDayChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  dueDayChipText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  dueDayChipTextActive: {
    color: '#fff',
  },
  // Buttons
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelButton: { marginTop: 12, alignItems: 'center', padding: 12 },
  cancelText: { color: '#666', fontSize: 16 },
  // Recurring manage modal
  recurringCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  recurringCardInactive: {
    opacity: 0.5,
  },
  recurringName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  recurringNameInactive: {
    textDecorationLine: 'line-through',
  },
  recurringMeta: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
  recurringActions: {
    gap: 10,
    alignItems: 'flex-end',
  },
  recurringActionText: {
    fontSize: 14,
    color: '#4f46e5',
    fontWeight: '500',
  },
  recurringDeleteText: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '500',
  },
  editRecurringCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#4f46e5',
  },
  editRecInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    marginBottom: 10,
    backgroundColor: '#fff',
    color: '#1a1a1a',
  },
  editRecButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  editRecSave: {
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  editRecSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
