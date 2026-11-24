import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/motion';
import { Muted, theme } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';

/** One money line (expense or monthly cost) with a delete control that asks first. */
export function MoneyRow({
  title,
  detail,
  amount,
  onDelete,
  kind = 'expense',
}: {
  title: string;
  detail?: string;
  amount: string;
  onDelete: () => Promise<void> | void;
  kind?: 'expense' | 'monthly cost';
}) {
  async function remove() {
    const ok = await confirmAction(
      `Delete this ${kind}?`,
      `"${title}" (${amount}) will be removed from your totals, budgets and splits.`,
      'Delete',
    );
    if (ok) await onDelete();
  }
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      <Text style={styles.amount}>{amount}</Text>
      <PressableScale onPress={remove} style={styles.delete} accessibilityLabel={`Delete ${title}`}>
        <Text style={styles.deleteLabel}>✕</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  title: { color: theme.ink, fontWeight: '600', fontSize: 15 },
  amount: { color: theme.ink, fontWeight: '700' },
  delete: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.coralSoft, alignItems: 'center', justifyContent: 'center' },
  deleteLabel: { color: theme.danger, fontWeight: '800', fontSize: 13 },
});
