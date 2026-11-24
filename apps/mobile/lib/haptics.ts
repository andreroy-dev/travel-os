import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Light tap feedback for selections. Silent on web and when haptics are unavailable. */
export function tap() {
  if (Platform.OS === 'web') return;
  void Haptics.selectionAsync().catch(() => undefined);
}

/** A firmer confirmation for completed actions (saved, archived, imported). */
export function success() {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}
