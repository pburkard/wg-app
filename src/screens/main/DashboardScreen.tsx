import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Apartment, CleaningTask, CleaningCompletion, Profile } from '../../types/database';

/* ── helpers ── */

function getWeekBounds(offset = 0): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

function getDueDate(task: CleaningTask): Date {
  if (!task.last_rotated_at) return new Date();
  const last = new Date(task.last_rotated_at);
  const due = new Date(last);
  due.setDate(due.getDate() + task.frequency_days);
  return due;
}

function formatDueDate(task: CleaningTask): string {
  const due = getDueDate(task);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return due.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
}

function isOverdue(task: CleaningTask): boolean {
  return getDueDate(task) < new Date();
}

export default function DashboardScreen() {
  const { profile, user } = useAuth();
  const [apartment, setApartment] = useState<Apartment | null>(null);
  const [allTasks, setAllTasks] = useState<CleaningTask[]>([]);
  const [completionsThisWeek, setCompletionsThisWeek] = useState<CleaningCompletion[]>([]);
  const [completionsNextWeek, setCompletionsNextWeek] = useState<CleaningCompletion[]>([]);
  const [totalCompletions, setTotalCompletions] = useState(0);
  const [members, setMembers] = useState<Profile[]>([]);
  const [myBalance, setMyBalance] = useState(0);

  const thisWeek = useMemo(() => getWeekBounds(0), []);
  const nextWeek = useMemo(() => getWeekBounds(1), []);

  const fetchData = useCallback(async () => {
    if (!profile?.apartment_id) return;

    const { data: apt } = await supabase
      .from('apartments')
      .select('*')
      .eq('id', profile.apartment_id)
      .single();
    if (apt) setApartment(apt as Apartment);

    const { data: mems } = await supabase
      .from('profiles')
      .select('*')
      .eq('apartment_id', profile.apartment_id);
    if (mems) setMembers(mems as Profile[]);

    const { data: tasks } = await supabase
      .from('cleaning_tasks')
      .select('*')
      .eq('apartment_id', profile.apartment_id);
    if (tasks) setAllTasks(tasks as CleaningTask[]);

    // Get apartment task IDs for filtering completions
    const aptTaskIds = (tasks as CleaningTask[]).map((t) => t.id);

    if (aptTaskIds.length > 0) {
      // Completions this week (scoped to apartment tasks)
      const { data: compTW } = await supabase
        .from('cleaning_completions')
        .select('*')
        .in('task_id', aptTaskIds)
        .gte('due_date', thisWeek.start)
        .lte('due_date', thisWeek.end);
      if (compTW) setCompletionsThisWeek(compTW as CleaningCompletion[]);

      // Completions next week (scoped to apartment tasks)
      const { data: compNW } = await supabase
        .from('cleaning_completions')
        .select('*')
        .in('task_id', aptTaskIds)
        .gte('due_date', nextWeek.start)
        .lte('due_date', nextWeek.end);
      if (compNW) setCompletionsNextWeek(compNW as CleaningCompletion[]);
    } else {
      setCompletionsThisWeek([]);
      setCompletionsNextWeek([]);
    }

    // Total completions by me
    const { count } = await supabase
      .from('cleaning_completions')
      .select('*', { count: 'exact', head: true })
      .eq('completed_by', user!.id);
    setTotalCompletions(count ?? 0);

    // Balance
    const { data: splits } = await supabase
      .from('expense_splits')
      .select('*, expenses!inner(apartment_id, paid_by)')
      .eq('expenses.apartment_id', profile.apartment_id)
      .eq('settled', false);

    if (splits) {
      let net = 0;
      for (const s of splits as any[]) {
        const amt = Number(s.amount_owed);
        if (s.expenses.paid_by === user?.id && s.user_id !== user?.id) {
          net += amt;
        } else if (s.user_id === user?.id && s.expenses.paid_by !== user?.id) {
          net -= amt;
        }
      }
      setMyBalance(net);
    }
  }, [profile?.apartment_id, user?.id, thisWeek, nextWeek]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  /* ── derive my tasks for this/next week ── */

  function isMyTurn(task: CleaningTask): boolean {
    if (task.rotation_order.length === 0) return false;
    return task.rotation_order[task.current_index % task.rotation_order.length] === user?.id;
  }

  // Will it be my turn next rotation? (next index after current)
  function isMyTurnNext(task: CleaningTask): boolean {
    if (task.rotation_order.length === 0) return false;
    const nextIndex = (task.current_index + 1) % task.rotation_order.length;
    return task.rotation_order[nextIndex] === user?.id;
  }

  function isDueThisWeek(task: CleaningTask): boolean {
    const due = getDueDate(task);
    return due <= new Date(thisWeek.end + 'T23:59:59');
  }

  function isDueNextWeek(task: CleaningTask): boolean {
    const due = getDueDate(task);
    const nextWeekEnd = new Date(nextWeek.end + 'T23:59:59');
    const nextWeekStart = new Date(nextWeek.start + 'T00:00:00');
    // Due date falls in next week, OR due this week but will rotate to me next
    return (due >= nextWeekStart && due <= nextWeekEnd);
  }

  function isCompletedIn(task: CleaningTask, comps: CleaningCompletion[]): boolean {
    return comps.some((c) => c.task_id === task.id);
  }

  // This week: my turn, due this week or overdue, NOT completed
  const myTasksThisWeek = allTasks
    .filter((t) => isMyTurn(t) && isDueThisWeek(t) && !isCompletedIn(t, completionsThisWeek))
    .sort((a, b) => getDueDate(a).getTime() - getDueDate(b).getTime());

  // This week's tasks all done — only then show next week preview
  const myTasksThisWeekAll = allTasks.filter((t) => isMyTurn(t) && isDueThisWeek(t));
  const thisWeekAllDone =
    myTasksThisWeekAll.length > 0 &&
    myTasksThisWeekAll.every((t) => isCompletedIn(t, completionsThisWeek));

  // Next week: tasks that will rotate to me next, due next week
  const myTasksNextWeek = thisWeekAllDone
    ? allTasks
        .filter((t) => isMyTurnNext(t) && isDueNextWeek(t) && !isCompletedIn(t, completionsNextWeek))
        .sort((a, b) => getDueDate(a).getTime() - getDueDate(b).getTime())
    : [];

  async function handleMarkDone(task: CleaningTask) {
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('cleaning_completions').insert({
      task_id: task.id,
      completed_by: user!.id,
      due_date: today,
    });
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    fetchData();
  }

  /* ── avatar sizing ── */

  const avatarSize = members.length <= 3 ? 36 : members.length <= 5 ? 30 : 24;
  const avatarOverlap = Math.round(avatarSize * 0.3);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>
        Welcome, {profile?.display_name ?? 'User'}
      </Text>

      {/* ── Apartment card with member avatars ── */}
      {apartment && (
        <View style={styles.card}>
          <View style={styles.aptRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                {apartment.name}{apartment.address ? `, ${apartment.address}` : ''}
              </Text>
              <Text style={styles.cardMeta}>
                {members.length} member{members.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={[styles.avatarRow, { width: avatarSize + (members.length - 1) * (avatarSize - avatarOverlap) }]}>
              {members.map((m, i) => (
                <View
                  key={m.id}
                  style={[
                    styles.avatarWrap,
                    {
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: avatarSize / 2,
                      left: i * (avatarSize - avatarOverlap),
                      zIndex: members.length - i,
                    },
                  ]}
                >
                  {m.avatar_url ? (
                    <Image
                      source={{ uri: m.avatar_url }}
                      style={{ width: avatarSize - 4, height: avatarSize - 4, borderRadius: (avatarSize - 4) / 2 }}
                    />
                  ) : (
                    <View
                      style={[
                        styles.avatarPlaceholder,
                        {
                          width: avatarSize - 4,
                          height: avatarSize - 4,
                          borderRadius: (avatarSize - 4) / 2,
                        },
                      ]}
                    >
                      <Text style={[styles.avatarInitial, { fontSize: Math.round(avatarSize * 0.38) }]}>
                        {(m.display_name ?? '?')[0].toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* ── Balance ── */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Your Balance</Text>
        <Text
          style={[
            styles.balanceAmount,
            myBalance >= 0 ? styles.positive : styles.negative,
          ]}
        >
          CHF {myBalance.toFixed(2)}
        </Text>
        <Text style={styles.cardMeta}>
          {myBalance > 0 ? 'Others owe you' : myBalance < 0 ? 'You owe others' : 'All settled up'}
        </Text>
      </View>

      {/* ── Cleaning duties this week ── */}
      <View style={styles.card}>
        <View style={styles.cleaningHeader}>
          <Text style={styles.cardLabel}>
            {myTasksThisWeek.length > 0 ? 'Your cleaning duties this week' : 'Cleaning duties'}
          </Text>
          {totalCompletions > 0 && (
            <View style={styles.completedBadge}>
              <Text style={styles.completedBadgeText}>{totalCompletions} done</Text>
            </View>
          )}
        </View>

        {myTasksThisWeek.length === 0 && myTasksNextWeek.length === 0 ? (
          <Text style={styles.cardMeta}>Nothing assigned to you right now.</Text>
        ) : (
          <>
            {myTasksThisWeek.map((t) => (
              <View key={t.id} style={[styles.taskCard, isOverdue(t) && styles.taskCardOverdue]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskName}>{t.name}</Text>
                  <Text style={[styles.taskDue, isOverdue(t) && styles.taskDueOverdue]}>
                    {formatDueDate(t)}
                  </Text>
                </View>
                <TouchableOpacity style={styles.markDoneBtn} onPress={() => handleMarkDone(t)}>
                  <Text style={styles.markDoneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* Next week preview */}
            {myTasksNextWeek.length > 0 && (
              <>
                <Text style={[styles.cardLabel, { marginTop: myTasksThisWeek.length > 0 ? 16 : 0, marginBottom: 4 }]}>
                  Coming up next week
                </Text>
                {myTasksNextWeek.map((t) => (
                  <View key={t.id} style={styles.taskCardPreview}>
                    <Text style={styles.taskNamePreview}>{t.name}</Text>
                    <Text style={styles.taskFreqPreview}>Every {t.frequency_days}d</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cardMeta: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: '700',
  },
  positive: {
    color: '#16a34a',
  },
  negative: {
    color: '#ef4444',
  },

  // Apartment row with avatars
  aptRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    position: 'relative',
    height: 40,
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f9f9f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontWeight: '700',
    color: '#4f46e5',
  },

  // Cleaning header
  cleaningHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  completedBadge: {
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  completedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#16a34a',
  },

  // Task cards
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  taskCardOverdue: {
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  taskName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  taskDue: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  taskDueOverdue: {
    color: '#ef4444',
    fontWeight: '600',
  },
  markDoneBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  markDoneBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // Next week preview
  taskCardPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  taskNamePreview: {
    fontSize: 14,
    color: '#999',
  },
  taskFreqPreview: {
    fontSize: 12,
    color: '#bbb',
  },
});
