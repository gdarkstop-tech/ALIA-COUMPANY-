import AsyncStorage from '@react-native-async-storage/async-storage';

/** Non-sensitive preference storage only (locale, theme, last viewed profile). Never tokens. */
export const prefs = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(`ghayarly:${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(`ghayarly:${key}`, JSON.stringify(value));
    } catch {
      // Preferences are a convenience; failures must never break the app.
    }
  },
};
