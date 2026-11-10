import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Muted, Screen, theme } from '@/components/ui';

const copy: Record<string, string> = {
  Map: 'The map opens when Google Maps is connected. Pins and travel times are not estimated here.',
  Expenses: 'Expenses, splits, and budgets arrive in a later version. No sample spending is shown.',
  Docs: 'The travel wallet is not in this version. Documents are not stored yet.',
  Memories: 'Photo organization and recaps arrive in a later version. Nothing is read from your photo library.',
};

export default function SoonScreen() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  const title = name ?? 'Later';
  return (
    <Screen>
      <Text style={styles.title}>{title}</Text>
      <Muted>{copy[title] ?? 'This part of Travel OS is designed and not built yet.'}</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: '700', color: theme.ink },
});
