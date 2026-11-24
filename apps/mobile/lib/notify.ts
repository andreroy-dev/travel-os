import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

type Reminder = { kind: string; title: string; body: string; when: string };

const storageKey = 'scheduled-reminders';

export async function scheduleReminderNotes(notes: Reminder[], enabled: boolean) {
  if (!enabled) return;
  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return;
  const raw = await AsyncStorage.getItem(storageKey);
  const done = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  for (const note of notes) {
    const key = `${note.kind}:${note.when}:${note.body}`;
    if (done.has(key)) continue;
    const when = new Date(`${note.when}T09:00:00`);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      content: { title: note.title, body: note.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    done.add(key);
  }
  await AsyncStorage.setItem(storageKey, JSON.stringify([...done]));
}
