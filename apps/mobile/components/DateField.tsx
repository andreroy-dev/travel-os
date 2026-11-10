import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '@/components/ui';

export function isoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function DateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.picker} onPress={() => setOpen((current) => !current)}>
        <Text style={value ? styles.value : styles.placeholder}>{value ? isoDate(value) : placeholder}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={value ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS !== 'ios') setOpen(false);
            if (date) onChange(date);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: { color: theme.muted, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  picker: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  value: { color: theme.ink, fontSize: 16, fontWeight: '600' },
  placeholder: { color: '#8d8680', fontSize: 16 },
});
