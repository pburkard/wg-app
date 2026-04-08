import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

type Props = {
  value: Date;
  onChange: (date: Date) => void;
  label?: string;
};

/**
 * Cross-platform date picker.
 * - iOS/Android: native DateTimePicker from @react-native-community/datetimepicker
 * - Web: HTML <input type="date">
 */
export default function DatePicker({ value, onChange, label }: Props) {
  const [showNative, setShowNative] = useState(false);

  const formatted = value.toLocaleDateString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (Platform.OS === 'web') {
    const isoVal = value.toISOString().split('T')[0];
    return (
      <View style={styles.container}>
        {label && <Text style={styles.label}>{label}</Text>}
        <input
          type="date"
          value={isoVal}
          onChange={(e) => {
            const d = new Date(e.target.value + 'T12:00:00');
            if (!isNaN(d.getTime())) onChange(d);
          }}
          style={{
            fontSize: 16,
            padding: 12,
            borderRadius: 12,
            border: '1px solid #ddd',
            backgroundColor: '#f9f9f9',
            color: '#1a1a1a',
            width: '100%',
            boxSizing: 'border-box' as const,
          }}
        />
      </View>
    );
  }

  // Native (iOS/Android)
  const RNDateTimePicker =
    require('@react-native-community/datetimepicker').default;

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity style={styles.button} onPress={() => setShowNative(true)}>
        <Text style={styles.buttonText}>{formatted}</Text>
      </TouchableOpacity>
      {showNative && (
        <RNDateTimePicker
          value={value}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_: any, date?: Date) => {
            setShowNative(Platform.OS === 'ios'); // iOS keeps picker open
            if (date) onChange(date);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
    marginTop: 4,
  },
  button: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f9f9f9',
  },
  buttonText: {
    fontSize: 16,
    color: '#1a1a1a',
  },
});
