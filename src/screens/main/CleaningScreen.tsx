import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { confirmAction } from '../../lib/confirm';
import DatePicker from '../../components/DatePicker';
import { useAuth } from '../../contexts/AuthContext';
import { CleaningTask, CleaningCompletion, Profile } from '../../types/database';

function getWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    weekStart: monday.toISOString().split('T')[0],
    weekEnd: sunday.toISOString().split('T')[0],
  };
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${s.toLocaleDateString('en', opts)} – ${e.toLocaleDateString('en', opts)}`;
}

export default function CleaningScreen() {
  const { profile, user } = useAuth();
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [completions, setCompletions] = useState<CleaningCompletion[]>([]);
  const [allCompletions, setAllCompletions] = useState<CleaningCompletion[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [showManage, setShowManage] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Shared form state for Add / Edit task modal
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null); // null = adding
  const [formName, setFormName] = useState('');
  const [formFrequency, setFormFrequency] = useState('7');
  const [formFirstDue, setFormFirstDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [loading, setLoading] = useState(false);

  const { weekStart, weekEnd } = useMemo(() => getWeekBounds(), []);

  const fetchTasks = useCallback(async () => {
    if (!profile?.apartment_id) return;
    const { data } = await supabase
      .from('cleaning_tasks')
      .select('*')
      .eq('apartment_id', profile.apartment_id)
      .order('created_at');
    if (data) setTasks(data as CleaningTask[]);
  }, [profile?.apartment_id]);

  const fetchCompletions = useCallback(async () => {
    if (!profile?.apartment_id) return;
    const { data } = await supabase
      .from('cleaning_completions')
      .select('*')
      .gte('due_date', weekStart)
      .lte('due_date', weekEnd);
    if (data) setCompletions(data as CleaningCompletion[]);
  }, [profile?.apartment_id, weekStart, weekEnd]);

  const fetchAllCompletions = useCallback(async () => {
    if (!profile?.apartment_id) return;
    // Fetch all completions for tasks in this apartment (for stats)
    const { data } = await supabase
      .from('cleaning_completions')
      .select('*')
      .in('task_id', (await supabase
        .from('cleaning_tasks')
        .select('id')
        .eq('apartment_id', profile.apartment_id)
      ).data?.map(t => t.id) || []);
    if (data) setAllCompletions(data as CleaningCompletion[]);
  }, [profile?.apartment_id]);

  const fetchMembers = useCallback(async () => {
    if (!profile?.apartment_id) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('apartment_id', profile.apartment_id);
    if (data) setMembers(data as Profile[]);
  }, [profile?.apartment_id]);

  useFocusEffect(
    useCallback(() => {
      fetchTasks();
      fetchCompletions();
      fetchAllCompletions();
      fetchMembers();
    }, [fetchTasks, fetchCompletions, fetchAllCompletions, fetchMembers]),
  );

  function getMemberName(id: string): string {
    return members.find((m) => m.id === id)?.display_name ?? 'Unknown';
  }

  function getAssignedUser(task: CleaningTask): string {
    if (task.rotation_order.length === 0) return 'No one';
    const userId = task.rotation_order[task.current_index % task.rotation_order.length];
    return getMemberName(userId);
  }

  function isMyTurn(task: CleaningTask): boolean {
    if (task.rotation_order.length === 0) return false;
    return task.rotation_order[task.current_index % task.rotation_order.length] === user?.id;
  }

  function isCompletedThisWeek(task: CleaningTask): boolean {
    return completions.some((c) => c.task_id === task.id);
  }

  function getCompletedBy(task: CleaningTask): string | null {
    const completion = completions.find((c) => c.task_id === task.id);
    if (!completion) return null;
    return getMemberName(completion.completed_by);
  }

  function getCompletionDate(task: CleaningTask): string | null {
    const completion = completions.find((c) => c.task_id === task.id);
    if (!completion) return null;
    const d = new Date(completion.completed_at);
    return d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function canUndo(task: CleaningTask): boolean {
    return completions.some(
      (c) => c.task_id === task.id && c.completed_by === user!.id,
    );
  }

  function getDueDate(task: CleaningTask): Date {
    if (!task.last_rotated_at) return new Date();
    const lastRotated = new Date(task.last_rotated_at);
    const due = new Date(lastRotated);
    due.setDate(due.getDate() + task.frequency_days);
    return due;
  }

  function formatDueDate(task: CleaningTask): string {
    const due = getDueDate(task);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Overdue';
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    return `Due ${due.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }

  function isOverdue(task: CleaningTask): boolean {
    const due = getDueDate(task);
    return due < new Date() && !isCompletedThisWeek(task);
  }

  // Task is due this week if it exists (current rotation period)
  function isDueThisWeek(task: CleaningTask): boolean {
    if (!task.last_rotated_at) return true;
    const lastRotated = new Date(task.last_rotated_at);
    const endOfWeek = new Date(weekEnd + 'T23:59:59');
    const daysSinceRotation = (endOfWeek.getTime() - lastRotated.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceRotation <= task.frequency_days + 7;
  }

  const visibleTasks = tasks
    .filter(isDueThisWeek)
    .sort((a, b) => {
      const aDone = isCompletedThisWeek(a) ? 1 : 0;
      const bDone = isCompletedThisWeek(b) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone; // undone first
      // Among undone: overdue first, then by due date ascending
      if (!aDone) return getDueDate(a).getTime() - getDueDate(b).getTime();
      return 0;
    });
  const doneCount = visibleTasks.filter((t) => isCompletedThisWeek(t)).length;

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

    fetchCompletions();
  }

  async function handleUndoDone(task: CleaningTask) {
    const completion = completions.find(
      (c) => c.task_id === task.id && c.completed_by === user!.id,
    );
    if (!completion) return;

    await supabase.from('cleaning_completions').delete().eq('id', completion.id);
    fetchCompletions();
  }

  const isAdmin = profile?.role === 'admin';

  // Compute last_rotated_at so that the first due date is exactly firstDueDate
  function lastRotatedForFirstDue(frequencyDays: number, firstDueDate: Date): string {
    const lastRotated = new Date(firstDueDate);
    lastRotated.setDate(firstDueDate.getDate() - frequencyDays);
    return lastRotated.toISOString();
  }

  async function handleReassign(task: CleaningTask, memberId: string) {
    const idx = task.rotation_order.indexOf(memberId);
    if (idx === -1) return;
    const { error } = await supabase
      .from('cleaning_tasks')
      .update({ current_index: idx })
      .eq('id', task.id);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    fetchTasks();
  }


  function handleDelete(task: CleaningTask) {
    confirmAction(
      'Delete Task',
      `Delete "${task.name}"?`,
      async () => {
        await supabase.from('cleaning_tasks').delete().eq('id', task.id);
        fetchTasks();
      },
      'Delete',
      true,
    );
  }

  function openAddForm() {
    setEditingTaskId(null);
    setFormName('');
    setFormFrequency('7');
    setFormFirstDue(new Date(Date.now() + 86400000));
    setShowTaskForm(true);
  }

  function openEditForm(task: CleaningTask) {
    setEditingTaskId(task.id);
    setFormName(task.name);
    setFormFrequency(String(task.frequency_days));
    const due = new Date(task.last_rotated_at);
    due.setDate(due.getDate() + task.frequency_days);
    setFormFirstDue(due);
    setShowTaskForm(true);
  }

  function closeTaskForm() {
    setShowTaskForm(false);
    setEditingTaskId(null);
  }

  async function handleFormSave() {
    const name = formName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a task name.');
      return;
    }

    setLoading(true);
    const freqDays = parseInt(formFrequency, 10) || 7;

    if (editingTaskId) {
      // Edit existing task
      const { error } = await supabase
        .from('cleaning_tasks')
        .update({
          name,
          frequency_days: freqDays,
          last_rotated_at: lastRotatedForFirstDue(freqDays, formFirstDue),
        })
        .eq('id', editingTaskId);

      setLoading(false);
      if (error) { Alert.alert('Error', error.message); return; }
    } else {
      // Add new task
      const memberIds = members.map((m) => m.id);
      const startIndex = memberIds.length > 0 ? tasks.length % memberIds.length : 0;

      const { error } = await supabase.from('cleaning_tasks').insert({
        apartment_id: profile!.apartment_id,
        name,
        frequency_days: freqDays,
        rotation_order: memberIds,
        current_index: startIndex,
        last_rotated_at: lastRotatedForFirstDue(freqDays, formFirstDue),
      });

      setLoading(false);
      if (error) { Alert.alert('Error', error.message); return; }
    }

    closeTaskForm();
    fetchTasks();
  }

  async function handleAskForHelp(task: CleaningTask) {
    if (!profile?.apartment_id) return;
    try {
      // Fetch all members to get their push tokens
      const { data: mems } = await supabase
        .from('profiles')
        .select('id, display_name, push_token')
        .eq('apartment_id', profile.apartment_id)
        .neq('id', user!.id); // Don't notify self

      if (!mems || mems.length === 0) return;

      // Send push notification via edge function
      const { error } = await supabase.functions.invoke('send-notification', {
        body: {
          tokens: mems.map((m) => m.push_token).filter(Boolean),
          title: `${profile.display_name} needs help`,
          body: `${task.name} is overdue`,
        },
      });

      if (error) {
        Alert.alert('Error', 'Failed to send notification');
      } else {
        Alert.alert('Sent', 'Help request sent to members');
      }
    } catch (err) {
      Alert.alert('Error', String(err));
    }
  }

  // ─── Main view: task card ───

  function renderTask({ item }: { item: CleaningTask }) {
    const done = isCompletedThisWeek(item);
    const mine = isMyTurn(item);
    const completedBy = getCompletedBy(item);
    const completedDate = getCompletionDate(item);
    const overdue = isOverdue(item);

    // Get assigned/completed-by member
    const memberIdToShow = done
      ? completions.find((c) => c.task_id === item.id)?.completed_by
      : item.rotation_order.length > 0
        ? item.rotation_order[item.current_index % item.rotation_order.length]
        : null;
    const memberInfo = memberIdToShow ? members.find((m) => m.id === memberIdToShow) : null;

    return (
      <View style={[styles.card, done && styles.cardDone, !done && overdue && styles.cardOverdue]}>
        <View style={styles.cardRow}>
          {/* Avatar */}
          <View style={styles.cardAvatar}>
            {memberInfo?.avatar_url ? (
              <Image
                source={{ uri: memberInfo.avatar_url }}
                style={styles.cardAvatarImage}
              />
            ) : (
              <View style={styles.cardAvatarPlaceholder}>
                <Text style={styles.cardAvatarInitial}>
                  {(memberInfo?.display_name ?? '?')[0].toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.cardInfo}>
            <View style={styles.cardTitleRow}>
              {done && <Text style={styles.checkmark}>✓</Text>}
              <Text style={[styles.cardTitle, done && styles.cardTitleDone]}>{item.name}</Text>
            </View>
            {done ? (
              <Text style={styles.completedText}>
                {completedBy}{completedDate ? ` · ${completedDate}` : ''}
              </Text>
            ) : (
              <Text style={styles.assignedText}>
                {mine ? 'Your turn' : getAssignedUser(item)}
              </Text>
            )}
          </View>

          {done ? (
            canUndo(item) ? (
              <TouchableOpacity style={styles.undoButton} onPress={() => handleUndoDone(item)}>
                <Text style={styles.undoButtonText}>Undo</Text>
              </TouchableOpacity>
            ) : null
          ) : (
            <View style={styles.cardRight}>
              <View style={[styles.dueBadge, overdue && styles.dueBadgeOverdue]}>
                <Text style={[styles.dueBadgeText, overdue && styles.dueBadgeTextOverdue]}>
                  {formatDueDate(item)}
                </Text>
              </View>
              {overdue && (
                <TouchableOpacity style={styles.helpButton} onPress={() => handleAskForHelp(item)}>
                  <Text style={styles.helpButtonText}>Ask for help</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.doneButton} onPress={() => handleMarkDone(item)}>
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  // ─── Manage modal: task list item ───

  function renderManageTask({ item }: { item: CleaningTask }) {
    const assignedId = item.rotation_order.length > 0
      ? item.rotation_order[item.current_index % item.rotation_order.length]
      : null;

    return (
      <View style={styles.manageRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.manageName}>{item.name}</Text>
          <Text style={styles.manageMeta}>
            Every {item.frequency_days}d · Assigned: {assignedId ? getMemberName(assignedId) : 'No one'}
          </Text>
          {isAdmin && item.rotation_order.length > 1 && (
            <View style={styles.reassignRow}>
              {item.rotation_order.map((mid) => (
                <TouchableOpacity
                  key={mid}
                  style={[styles.reassignChip, mid === assignedId && styles.reassignChipActive]}
                  onPress={() => handleReassign(item, mid)}
                >
                  <Text style={[styles.reassignChipText, mid === assignedId && styles.reassignChipTextActive]}>
                    {getMemberName(mid)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        {isAdmin && (
          <View style={styles.manageActions}>
            <TouchableOpacity style={styles.editButton} onPress={() => openEditForm(item)}>
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Tasks</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setShowStats(true)}>
            <Text style={styles.headerButton}>Stats</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowManage(true)}>
            <Text style={styles.headerButton}>Manage</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Weekly progress */}
      {visibleTasks.length > 0 && (
        <View style={styles.progressBar}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressText}>
              {doneCount}/{visibleTasks.length} done this week
            </Text>
            <Text style={styles.weekRange}>
              {formatWeekRange(weekStart, weekEnd)}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${visibleTasks.length > 0 ? (doneCount / visibleTasks.length) * 100 : 0}%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Task list */}
      <FlatList
        data={visibleTasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={visibleTasks.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.emptyContent}>
            <Text style={styles.placeholder}>No cleaning tasks yet.</Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => setShowManage(true)}
            >
              <Text style={styles.emptyButtonText}>Set up tasks</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={renderTask}
      />

      {/* ─── Manage Tasks Modal ─── */}
      <Modal visible={showManage} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.manageModal}>
            <View style={styles.manageHeader}>
              <Text style={styles.modalTitle}>Manage Tasks</Text>
              <TouchableOpacity onPress={() => setShowManage(false)}>
                <Text style={styles.closeButton}>Done</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={tasks}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.managePlaceholder}>
                  No tasks yet. Add one below.
                </Text>
              }
              renderItem={renderManageTask}
              style={styles.manageList}
            />

            <TouchableOpacity
              style={styles.addTaskButton}
              onPress={openAddForm}
            >
              <Text style={styles.addTaskButtonText}>+ Add Task</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Add / Edit Task Modal ─── */}
      <Modal visible={showTaskForm} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView style={styles.addModal} keyboardShouldPersistTaps="handled">
            <View style={styles.formHeader}>
              <TouchableOpacity onPress={closeTaskForm}>
                <Text style={styles.formHeaderAction}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.formHeaderTitle}>
                {editingTaskId ? 'Edit Task' : 'New Task'}
              </Text>
              <TouchableOpacity onPress={handleFormSave} disabled={loading}>
                <Text style={[styles.formHeaderAction, loading && { opacity: 0.5 }]}>
                  {loading ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Task name</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. Kitchen, Vacuum, Take out trash"
                value={formName}
                onChangeText={setFormName}
                placeholderTextColor="#bbb"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Frequency (days)</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="7"
                value={formFrequency}
                onChangeText={setFormFrequency}
                keyboardType="number-pad"
                placeholderTextColor="#bbb"
              />
            </View>

            <DatePicker
              label="First due on"
              value={formFirstDue}
              onChange={setFormFirstDue}
            />

            {editingTaskId && (
              <TouchableOpacity
                style={styles.deleteFormButton}
                onPress={() => {
                  const task = tasks.find((t) => t.id === editingTaskId);
                  if (task) {
                    closeTaskForm();
                    handleDelete(task);
                  }
                }}
              >
                <Text style={styles.deleteFormButtonText}>Delete Task</Text>
              </TouchableOpacity>
            )}
            <View style={{ height: 20 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Stats Modal ─── */}
      <Modal visible={showStats} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.statsModal}>
            <View style={styles.statsHeader}>
              <Text style={styles.modalTitle}>Completion Stats</Text>
              <TouchableOpacity onPress={() => setShowStats(false)}>
                <Text style={styles.closeButton}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.statsContent}>
              {/* Leaderboard - Last 12 weeks */}
              <View style={styles.statsSection}>
                <Text style={styles.statsTitle}>On-Time Completion</Text>
                <Text style={styles.heatmapSubtitle}>Last 12 weeks</Text>
                {members.length === 0 ? (
                  <Text style={styles.placeholder}>No members</Text>
                ) : (
                  members
                    .map((m) => {
                      // Only count completions from last 12 weeks
                      const twelveWeeksAgo = new Date();
                      twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84); // 12 * 7

                      const memberCompletions = allCompletions.filter(
                        (c) =>
                          c.completed_by === m.id &&
                          new Date(c.completed_at) >= twelveWeeksAgo
                      ).length;

                      // Total completions in 12 weeks to calculate relative performance
                      const totalCompletions = allCompletions.filter(
                        (c) => new Date(c.completed_at) >= twelveWeeksAgo
                      ).length;

                      // Rate = % of all 12-week completions done by this member
                      const rate = totalCompletions > 0 ? Math.round((memberCompletions / totalCompletions) * 100) : 0;
                      return { member: m, completions: memberCompletions, rate };
                    })
                    .sort((a, b) => b.rate - a.rate || b.completions - a.completions)
                    .map((stat) => {
                      // Color code: green (>80%), yellow (50-80%), red (<50%)
                      let barColor = '#ef4444'; // red
                      if (stat.rate >= 80) barColor = '#16a34a'; // green
                      else if (stat.rate >= 50) barColor = '#eab308'; // yellow

                      return (
                        <View key={stat.member.id} style={styles.leaderboardRow}>
                          <View style={styles.leaderboardInfo}>
                            <Text style={styles.leaderboardName}>{stat.member.display_name}</Text>
                            <Text style={styles.leaderboardMeta}>
                              {stat.completions} tasks completed
                            </Text>
                          </View>
                          <View style={styles.leaderboardBarContainer}>
                            <View style={[styles.leaderboardBar, { width: `${stat.rate}%`, backgroundColor: barColor }]} />
                          </View>
                          <Text style={styles.leaderboardPercent}>{stat.rate}%</Text>
                        </View>
                      );
                    })
                )}
              </View>

              {/* Heatmap */}
              <View style={styles.statsSection}>
                <Text style={styles.statsTitle}>Completion History</Text>
                <Text style={styles.heatmapSubtitle}>
                  Each square = 1 week · darker = more completions
                </Text>

                {/* Week number headers */}
                <View style={styles.heatmapHeaderRow}>
                  <View style={{ minWidth: 80 }} />
                  <View style={styles.heatmapCells}>
                    {Array.from({ length: 12 }).map((_, weekIdx) => {
                      const d = new Date();
                      d.setDate(d.getDate() - (11 - weekIdx) * 7);
                      // ISO week number
                      const jan4 = new Date(d.getFullYear(), 0, 4);
                      const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
                      return (
                        <Text key={weekIdx} style={styles.heatmapWeekLabel}>
                          {weekNum}
                        </Text>
                      );
                    })}
                  </View>
                </View>

                {members.length === 0 ? (
                  <Text style={styles.placeholder}>No members</Text>
                ) : (() => {
                  // Total tasks in apartment = max possible completions per week
                  const maxPerWeek = Math.max(tasks.length, 1);

                  return members.map((m) => (
                    <View key={m.id} style={styles.heatmapRow}>
                      <Text style={styles.heatmapLabel}>{m.display_name}</Text>
                      <View style={styles.heatmapCells}>
                        {Array.from({ length: 12 }).map((_, weekIdx) => {
                          const wStart = new Date();
                          wStart.setDate(wStart.getDate() - (11 - weekIdx) * 7);
                          wStart.setHours(0, 0, 0, 0);
                          const wEnd = new Date(wStart);
                          wEnd.setDate(wStart.getDate() + 6);

                          const count = allCompletions.filter(
                            (c) =>
                              c.completed_by === m.id &&
                              new Date(c.completed_at) >= wStart &&
                              new Date(c.completed_at) <= wEnd
                          ).length;

                          // Scale thresholds relative to total task count
                          const ratio = count / maxPerWeek;
                          let bg = '#ebedf0';
                          if (ratio >= 1)    bg = '#196127';
                          else if (ratio >= 0.75) bg = '#239a3b';
                          else if (ratio >= 0.5)  bg = '#7bc96f';
                          else if (ratio > 0)     bg = '#c6e48b';

                          return (
                            <View
                              key={weekIdx}
                              style={[styles.heatmapCell, { backgroundColor: bg }]}
                            />
                          );
                        })}
                      </View>
                    </View>
                  ));
                })()}

                {/* Legend */}
                <View style={styles.heatmapLegend}>
                  <Text style={styles.heatmapLegendLabel}>Less</Text>
                  {['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127'].map((c) => (
                    <View key={c} style={[styles.heatmapCell, { backgroundColor: c }]} />
                  ))}
                  <Text style={styles.heatmapLegendLabel}>More</Text>
                </View>
              </View>
            </ScrollView>
          </View>
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
    gap: 16,
  },
  headerButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4f46e5',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  // Progress
  progressBar: {
    marginBottom: 20,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressText: {
    fontSize: 13,
    color: '#999',
  },
  weekRange: {
    fontSize: 13,
    color: '#999',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#16a34a',
    borderRadius: 3,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContent: {
    alignItems: 'center',
  },
  placeholder: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  // Task cards
  card: {
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  cardDone: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  cardOverdue: {
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  cardAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardAvatarInitial: {
    fontWeight: '700',
    color: '#4f46e5',
    fontSize: 16,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkmark: {
    fontSize: 15,
    fontWeight: '700',
    color: '#16a34a',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  cardTitleDone: {
    color: '#16a34a',
  },
  assignedText: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  completedText: {
    fontSize: 13,
    color: '#16a34a',
    marginTop: 2,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  dueBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  dueBadgeOverdue: {
    backgroundColor: '#fef2f2',
  },
  dueBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4f46e5',
  },
  dueBadgeTextOverdue: {
    color: '#ef4444',
  },
  helpButton: {
    backgroundColor: '#ef4444',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  helpButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: '#4f46e5',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  undoButton: {
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  undoButtonText: {
    color: '#666',
    fontSize: 13,
    fontWeight: '600',
  },

  // Manage modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  manageModal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  manageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4f46e5',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  manageList: {
    flexGrow: 0,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  manageName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  manageMeta: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
  reassignRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  reassignChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
  },
  reassignChipActive: {
    backgroundColor: '#4f46e5',
  },
  reassignChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
  },
  reassignChipTextActive: {
    color: '#fff',
  },
  managePlaceholder: {
    fontSize: 15,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 24,
  },
  manageActions: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
    marginLeft: 12,
  },
  editButton: {
    backgroundColor: '#4f46e5',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  editButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
    marginTop: 4,
  },
  fieldInput: {
    fontSize: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
    color: '#1a1a1a',
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  formHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  formHeaderAction: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4f46e5',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  deleteFormButton: {
    marginTop: 24,
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  deleteFormButtonText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
  addTaskButton: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  addTaskButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Add task modal
  addModal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
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
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Stats modal
  statsModal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    flexShrink: 1,
    maxHeight: '90%',
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statsContent: {
    flexShrink: 1,
  },
  statsSection: {
    marginBottom: 24,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },

  // Leaderboard
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  leaderboardInfo: {
    minWidth: 100,
  },
  leaderboardName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  leaderboardMeta: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  leaderboardBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  leaderboardBar: {
    height: 8,
    borderRadius: 4,
    minWidth: 4,
  },
  leaderboardPercent: {
    minWidth: 35,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },

  // Heatmap
  heatmapSubtitle: {
    fontSize: 12,
    color: '#999',
    marginBottom: 10,
  },
  heatmapHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 12,
  },
  heatmapWeekLabel: {
    width: 16,
    fontSize: 9,
    color: '#bbb',
    textAlign: 'center',
  },
  heatmapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  heatmapLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1a1a1a',
    minWidth: 80,
  },
  heatmapCells: {
    flexDirection: 'row',
    gap: 3,
    flex: 1,
  },
  heatmapCell: {
    width: 16,
    height: 16,
    borderRadius: 3,
    backgroundColor: '#ebedf0',
  },
  heatmapLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    justifyContent: 'flex-end',
  },
  heatmapLegendLabel: {
    fontSize: 11,
    color: '#999',
    marginHorizontal: 2,
  },
});
