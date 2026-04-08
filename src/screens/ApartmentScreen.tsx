import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { notifyApartmentMembers } from '../lib/notifications';
import { useAuth } from '../contexts/AuthContext';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function ApartmentScreen() {
  const { user, refreshProfile } = useAuth();
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter an apartment name.');
      return;
    }

    setLoading(true);
    try {
      const code = generateInviteCode();

      const { data: apartment, error: aptError } = await supabase
        .from('apartments')
        .insert({
          name: name.trim(),
          address: address.trim() || null,
          created_by: user!.id,
          invite_code: code,
        })
        .select()
        .single();

      if (aptError) {
        Alert.alert('Apartment Error', aptError.message);
        return;
      }

      if (!apartment) {
        Alert.alert('Apartment Error', 'Insert succeeded but no data returned.');
        return;
      }

      const { error: profileError, data: updatedProfile } = await supabase
        .from('profiles')
        .update({ apartment_id: apartment.id, role: 'admin' })
        .eq('id', user!.id)
        .select();

      if (profileError) {
        Alert.alert('Profile Error', profileError.message);
        return;
      }

      if (!updatedProfile || updatedProfile.length === 0) {
        Alert.alert('Profile Error', 'Update returned no rows.');
        return;
      }

      await refreshProfile();
    } catch (e: any) {
      Alert.alert('Unexpected Error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!inviteCode.trim()) {
      Alert.alert('Error', 'Please enter an invite code.');
      return;
    }

    setLoading(true);

    const { data: apartment, error: findError } = await supabase
      .from('apartments')
      .select('id')
      .eq('invite_code', inviteCode.trim().toUpperCase())
      .single();

    if (findError || !apartment) {
      setLoading(false);
      Alert.alert('Error', 'Invalid invite code.');
      return;
    }

    const { error: profileError, data: updatedProfile } = await supabase
      .from('profiles')
      .update({ apartment_id: apartment.id, role: 'member' })
      .eq('id', user!.id)
      .select();

    if (profileError) {
      setLoading(false);
      Alert.alert('Error', profileError.message);
      return;
    }

    if (!updatedProfile || updatedProfile.length === 0) {
      setLoading(false);
      Alert.alert('Error', 'Profile update returned no rows. Check RLS policies.');
      return;
    }

    // Add user to rotation_order of all existing cleaning tasks
    const { data: tasks } = await supabase
      .from('cleaning_tasks')
      .select('id, rotation_order')
      .eq('apartment_id', apartment.id);

    if (tasks) {
      for (const task of tasks) {
        await supabase
          .from('cleaning_tasks')
          .update({ rotation_order: [...task.rotation_order, user!.id] })
          .eq('id', task.id);
      }
    }

    setLoading(false);
    await refreshProfile();

    // Notify existing members
    const displayName = (await supabase.from('profiles').select('display_name').eq('id', user!.id).single()).data?.display_name ?? 'Someone';
    notifyApartmentMembers(
      apartment.id,
      user!.id,
      'New Member',
      `${displayName} joined the WG!`,
    ).catch(() => {});
  }

  if (mode === 'choose') {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Join or Create a WG</Text>
          <Text style={styles.subtitle}>
            You need an apartment to get started.
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={() => setMode('create')}
          >
            <Text style={styles.buttonText}>Create New WG</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.buttonOutline}
            onPress={() => setMode('join')}
          >
            <Text style={styles.buttonOutlineText}>Join with Invite Code</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === 'create') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <Text style={styles.title}>Create Your WG</Text>

          <TextInput
            style={styles.input}
            placeholder="Apartment Name"
            value={name}
            onChangeText={setName}
            placeholderTextColor="#999"
          />

          <TextInput
            style={styles.input}
            placeholder="Address (optional)"
            value={address}
            onChangeText={setAddress}
            placeholderTextColor="#999"
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Creating...' : 'Create WG'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => setMode('choose')}
          >
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Join a WG</Text>

        <TextInput
          style={styles.input}
          placeholder="Invite Code"
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
          placeholderTextColor="#999"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleJoin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Joining...' : 'Join WG'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => setMode('choose')}
        >
          <Text style={styles.linkText}>Back</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    color: '#666',
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
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#4f46e5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonOutlineText: {
    color: '#4f46e5',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#666',
  },
});
