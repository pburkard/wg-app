import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirmation dialog.
 * On web, Alert.alert callbacks don't fire, so we use window.confirm instead.
 */
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  confirmLabel = 'OK',
  destructive = false,
) {
  if (Platform.OS === 'web') {
    if (confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ]);
  }
}
