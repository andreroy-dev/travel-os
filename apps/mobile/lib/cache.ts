import AsyncStorage from '@react-native-async-storage/async-storage';

export async function loadCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const fresh = await load();
    await AsyncStorage.setItem(key, JSON.stringify(fresh)).catch(() => undefined);
    return fresh;
  } catch (error) {
    const saved = await AsyncStorage.getItem(key).catch(() => null);
    if (saved) return JSON.parse(saved) as T;
    throw error;
  }
}
