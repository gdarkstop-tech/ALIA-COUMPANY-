import { Alert, Platform } from 'react-native';

/** Asks before a destructive action (native alert; the browser's confirm on web). */
export function confirmDestructive(message: string, labels: { cancel: string; confirm: string }, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(message)) onYes();
    return;
  }
  Alert.alert(message, undefined, [{ text: labels.cancel, style: 'cancel' }, { text: labels.confirm, style: 'destructive', onPress: onYes }]);
}
