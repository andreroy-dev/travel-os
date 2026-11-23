import { Alert, Platform } from 'react-native';

/**
 * Ask before doing something the user would not expect to happen on one tap.
 * Alert.alert has no buttons on web, so web falls back to window.confirm.
 */
export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
