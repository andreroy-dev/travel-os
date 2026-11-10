import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const theme = {
  paper: '#f3f6f1',
  card: '#ffffff',
  ink: '#14211c',
  muted: '#66716c',
  line: '#e3ebe6',
  clay: '#f07b4a',
  moss: '#0f6e56',
  mossDeep: '#0c5c48',
  mossSoft: '#e7f3ee',
  danger: '#c2412d',
  coralSoft: '#fff1ea',
};

export const serif = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia, "Iowan Old Style", Palatino, serif',
});

export function Screen({
  children,
  onRefresh,
  refreshing,
  safeTop = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  safeTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, safeTop && { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.clay} />
        ) : undefined
      }>
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#a3988b"
        autoCapitalize="none"
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  tone?: 'primary' | 'quiet';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.button,
        tone === 'quiet' && styles.quietButton,
        pressed && styles.pressed,
      ]}>
      <View style={styles.buttonRow}>
        {busy ? <ActivityIndicator color={tone === 'quiet' ? theme.ink : '#fffdf8'} /> : null}
        <Text style={[styles.buttonLabel, tone === 'quiet' && styles.quietLabel]}>{label}</Text>
      </View>
    </Pressable>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

export function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label.replaceAll('_', ' ')}</Text>
    </View>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <Text style={styles.cardTitle}>{title}</Text>
      <Muted>{body}</Muted>
    </Card>
  );
}

export function labelize(value: string) {
  return value.replaceAll('_', ' ');
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    backgroundColor: theme.paper,
    ...(Platform.OS === 'web' ? { minHeight: '100vh' } : null),
  },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  title: { fontFamily: serif, fontSize: 34, color: theme.ink, lineHeight: 40 },
  muted: { color: theme.muted, fontSize: 15, lineHeight: 21 },
  card: {
    backgroundColor: theme.card,
    borderRadius: 18,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: theme.line,
  },
  cardTitle: { fontFamily: serif, fontSize: 20, color: theme.ink },
  field: { gap: 6 },
  label: {
    color: theme.muted,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: theme.ink,
    fontSize: 16,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  button: {
    backgroundColor: theme.moss,
    borderRadius: 999,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  quietButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.line },
  pressed: { opacity: 0.75 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonLabel: { color: '#fffdf8', fontSize: 16, fontWeight: '600' },
  quietLabel: { color: theme.ink },
  error: { color: theme.danger, fontSize: 14, lineHeight: 20 },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: theme.mossSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipLabel: { color: theme.moss, fontSize: 12, textTransform: 'capitalize' },
});
