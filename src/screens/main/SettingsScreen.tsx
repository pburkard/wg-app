import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
  TextInput,
  Image,
  Share,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { confirmAction } from '../../lib/confirm';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Apartment, Profile } from '../../types/database';

const MAX_WG_NAME_LENGTH = 20;

export default function SettingsScreen() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const [apartment, setApartment] = useState<Apartment | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [wgName, setWgName] = useState('');
  const [uploading, setUploading] = useState(false);

  // Change username
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');

  // Change email
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  // Change password
  const [editingPassword, setEditingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const isAdmin = profile?.role === 'admin';

  const fetchData = useCallback(async () => {
    if (!profile?.apartment_id) return;

    const { data: apt } = await supabase
      .from('apartments')
      .select('*')
      .eq('id', profile.apartment_id)
      .single();
    if (apt) {
      setApartment(apt as Apartment);
      setWgName(apt.name);
    }

    const { data: mems } = await supabase
      .from('profiles')
      .select('*')
      .eq('apartment_id', profile.apartment_id);
    if (mems) setMembers(mems as Profile[]);
  }, [profile?.apartment_id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Avatar ---
  async function handlePickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const filePath = `${user!.id}/avatar.${ext}`;

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, {
          contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', user!.id);

      if (updateError) throw updateError;

      await refreshProfile();
      fetchData();
    } catch (err: any) {
      Alert.alert('Upload failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // --- Change Username ---
  async function handleChangeUsername() {
    const trimmed = newUsername.trim();
    if (!trimmed) return;
    if (trimmed.length > 30) {
      Alert.alert('Too long', 'Username must be 30 characters or less.');
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', user!.id);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    await refreshProfile();
    setEditingUsername(false);
    setNewUsername('');
  }

  // --- WG Name ---
  async function handleSaveName() {
    const trimmed = wgName.trim();
    if (!trimmed || !apartment) return;
    if (trimmed.length > MAX_WG_NAME_LENGTH) {
      Alert.alert('Too long', `WG name must be ${MAX_WG_NAME_LENGTH} characters or less.`);
      return;
    }

    const { error } = await supabase
      .from('apartments')
      .update({ name: trimmed })
      .eq('id', apartment.id);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setEditingName(false);
    fetchData();
  }

  // --- Change Email ---
  async function handleChangeEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed) return;

    const { error } = await supabase.auth.updateUser({ email: trimmed });
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    Alert.alert('Confirmation sent', 'Check your new email inbox to confirm the change.');
    setEditingEmail(false);
    setNewEmail('');
  }

  // --- Change Password ---
  async function handleChangePassword() {
    if (newPassword.length < 6) {
      Alert.alert('Too short', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    Alert.alert('Success', 'Password updated.');
    setEditingPassword(false);
    setNewPassword('');
    setConfirmPassword('');
  }

  // --- Share Invite Code ---
  async function handleShareInvite() {
    if (!apartment) return;
    try {
      await Share.share({
        message: `Join our WG "${apartment.name}" on WG Manager! Use invite code: ${apartment.invite_code}`,
      });
    } catch (_) {}
  }

  // --- Admin Actions ---
  function handleTransferAdmin(member: Profile) {
    confirmAction(
      'Transfer Admin',
      `Make ${member.display_name} the new admin? You will become a regular member.`,
      async () => {
        await supabase.from('profiles').update({ role: 'admin' }).eq('id', member.id);
        await supabase.from('profiles').update({ role: 'member' }).eq('id', user!.id);
        await refreshProfile();
        fetchData();
      },
      'Transfer',
    );
  }

  function handleRemoveMember(member: Profile) {
    confirmAction(
      'Remove Member',
      `Remove ${member.display_name} from the WG? Their unsettled expenses will remain.`,
      async () => {
        const { data: tasks } = await supabase
          .from('cleaning_tasks')
          .select('id, rotation_order, current_index')
          .eq('apartment_id', profile!.apartment_id!);

        if (tasks) {
          for (const task of tasks) {
            const newOrder = task.rotation_order.filter((id: string) => id !== member.id);
            const newIndex = newOrder.length > 0 ? task.current_index % newOrder.length : 0;
            await supabase
              .from('cleaning_tasks')
              .update({ rotation_order: newOrder, current_index: newIndex })
              .eq('id', task.id);
          }
        }

        await supabase.from('profiles').update({ apartment_id: null, role: null }).eq('id', member.id);
        fetchData();
      },
      'Remove',
      true,
    );
  }

  function handleLeave() {
    confirmAction(
      'Leave WG',
      'Are you sure you want to leave this WG? This cannot be undone. Unsettled expenses will remain.',
      async () => {
        const { data: tasks } = await supabase
          .from('cleaning_tasks')
          .select('id, rotation_order, current_index')
          .eq('apartment_id', profile!.apartment_id!);

        if (tasks) {
          for (const task of tasks) {
            const newOrder = task.rotation_order.filter((id: string) => id !== user!.id);
            const newIndex = newOrder.length > 0 ? task.current_index % newOrder.length : 0;
            await supabase
              .from('cleaning_tasks')
              .update({ rotation_order: newOrder, current_index: newIndex })
              .eq('id', task.id);
          }
        }

        if (isAdmin) {
          const otherMembers = members.filter((m) => m.id !== user!.id);
          if (otherMembers.length > 0) {
            await supabase.from('profiles').update({ role: 'admin' }).eq('id', otherMembers[0].id);
          }
        }

        await supabase.from('profiles').update({ apartment_id: null, role: null }).eq('id', user!.id);
        await refreshProfile();
      },
      'Yes, Leave',
      true,
    );
  }

  function handleSignOut() {
    confirmAction('Sign Out', 'Are you sure you want to sign out?', signOut, 'Sign Out', true);
  }

  const avatarUrl = profile?.avatar_url;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      {/* Profile */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>

        {/* Avatar */}
        <View style={styles.avatarRow}>
          <TouchableOpacity onPress={handlePickAvatar} disabled={uploading}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {profile?.display_name?.charAt(0)?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )}
            {uploading && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Text style={styles.profileName}>{profile?.display_name ?? '-'}</Text>
            <Text style={styles.profileRole}>
              {isAdmin ? 'Admin' : 'Member'}
            </Text>
            <TouchableOpacity onPress={handlePickAvatar} disabled={uploading}>
              <Text style={styles.changePhotoText}>Change photo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Username */}
        <View style={styles.row}>
          <Text style={styles.label}>Username</Text>
          {editingUsername ? (
            <View style={styles.editColumn}>
              <TextInput
                style={styles.editInput}
                value={newUsername}
                onChangeText={setNewUsername}
                placeholder="New username"
                placeholderTextColor="#bbb"
                autoCapitalize="none"
                maxLength={30}
                autoFocus
              />
              <View style={styles.editActions}>
                <TouchableOpacity onPress={handleChangeUsername}>
                  <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingUsername(false); setNewUsername(''); }}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => { setNewUsername(profile?.display_name ?? ''); setEditingUsername(true); }}>
              <Text style={styles.editableValue}>{profile?.display_name ?? '-'} ✎</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Email */}
        <View style={styles.row}>
          <Text style={styles.label}>Email</Text>
          {editingEmail ? (
            <View style={styles.editColumn}>
              <TextInput
                style={styles.editInput}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="New email address"
                placeholderTextColor="#bbb"
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
              />
              <View style={styles.editActions}>
                <TouchableOpacity onPress={handleChangeEmail}>
                  <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingEmail(false); setNewEmail(''); }}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setEditingEmail(true)}>
              <Text style={styles.editableValue}>{user?.email ?? '-'} ✎</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Password */}
        <View style={styles.row}>
          <Text style={styles.label}>Password</Text>
          {editingPassword ? (
            <View style={styles.editColumn}>
              <TextInput
                style={styles.editInput}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="New password"
                placeholderTextColor="#bbb"
                secureTextEntry
              />
              <TextInput
                style={[styles.editInput, { marginTop: 6 }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
                placeholderTextColor="#bbb"
                secureTextEntry
              />
              <View style={styles.editActions}>
                <TouchableOpacity onPress={handleChangePassword}>
                  <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingPassword(false); setNewPassword(''); setConfirmPassword(''); }}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setEditingPassword(true)}>
              <Text style={styles.editableValue}>••••••••  ✎</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Apartment */}
      {apartment && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Apartment</Text>

          {/* Editable WG name */}
          <View style={styles.row}>
            <Text style={styles.label}>Name</Text>
            {editingName ? (
              <View style={styles.editRow}>
                <TextInput
                  style={styles.editInput}
                  value={wgName}
                  onChangeText={(t) => setWgName(t.slice(0, MAX_WG_NAME_LENGTH))}
                  maxLength={MAX_WG_NAME_LENGTH}
                  autoFocus
                />
                <TouchableOpacity onPress={handleSaveName}>
                  <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingName(false); setWgName(apartment.name); }}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingName(true)}>
                <Text style={styles.editableValue}>{apartment.name} ✎</Text>
              </TouchableOpacity>
            )}
          </View>

          {apartment.address && (
            <View style={styles.row}>
              <Text style={styles.label}>Address</Text>
              <Text style={styles.value}>{apartment.address}</Text>
            </View>
          )}

          <View style={styles.row}>
            <Text style={styles.label}>Invite Code</Text>
            <View style={styles.inviteRow}>
              <Text style={styles.inviteCode}>{apartment.invite_code}</Text>
              <TouchableOpacity onPress={handleShareInvite} style={styles.shareButton}>
                <Text style={styles.shareText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Members */}
      {members.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members</Text>
          {members.map((m) => {
            const isMe = m.id === user?.id;
            const memberIsAdmin = m.role === 'admin';

            return (
              <View key={m.id} style={styles.memberRow}>
                {m.avatar_url ? (
                  <Image source={{ uri: m.avatar_url }} style={styles.memberAvatar} />
                ) : (
                  <View style={styles.memberAvatarPlaceholder}>
                    <Text style={styles.memberAvatarInitial}>
                      {m.display_name?.charAt(0)?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.memberName}>
                    {m.display_name}{isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.memberRole}>
                    {memberIsAdmin ? 'Admin' : 'Member'}
                  </Text>
                </View>

                {isAdmin && !isMe && (
                  <View style={styles.memberActions}>
                    {!memberIsAdmin && (
                      <TouchableOpacity onPress={() => handleTransferAdmin(m)}>
                        <Text style={styles.actionText}>Make Admin</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => handleRemoveMember(m)}>
                      <Text style={styles.removeText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Danger Zone */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: '#ccc' }]}>Account</Text>
        <TouchableOpacity style={styles.textButton} onPress={handleLeave}>
          <Text style={styles.dangerText}>Leave WG</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.textButton} onPress={handleSignOut}>
          <Text style={styles.mutedDangerText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
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
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  value: {
    fontSize: 16,
    color: '#666',
  },
  editableValue: {
    fontSize: 16,
    color: '#4f46e5',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editColumn: {
    flex: 1,
    marginLeft: 12,
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
    justifyContent: 'flex-end',
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 15,
    minWidth: 120,
    color: '#1a1a1a',
    backgroundColor: '#f9f9f9',
  },
  saveText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4f46e5',
  },
  cancelText: {
    fontSize: 14,
    color: '#999',
  },
  // Avatar
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f0f0f0',
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#e8e5ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 26,
    fontWeight: '700',
    color: '#4f46e5',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  profileRole: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
  changePhotoText: {
    fontSize: 13,
    color: '#4f46e5',
    marginTop: 4,
  },
  // Invite
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inviteCode: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4f46e5',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  shareButton: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  shareText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // Members
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f0f0',
  },
  memberAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e8e5ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4f46e5',
  },
  memberName: {
    fontSize: 16,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  memberRole: {
    fontSize: 13,
    color: '#999',
    marginTop: 1,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionText: {
    fontSize: 14,
    color: '#4f46e5',
    fontWeight: '500',
  },
  removeText: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '500',
  },
  // Danger zone
  textButton: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dangerText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '500',
  },
  mutedDangerText: {
    color: '#999',
    fontSize: 16,
  },
});
