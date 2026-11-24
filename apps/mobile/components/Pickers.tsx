import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/motion';
import { Sheet } from '@/components/Sheet';
import { theme } from '@/components/ui';
import { currencies, currencyByCode, timeZones } from '@/lib/currencies';

export function CurrencyPicker({
  value,
  onChange,
  opened,
  onClose,
}: {
  value: string;
  onChange: (code: string) => void;
  opened?: boolean;
  onClose?: () => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = opened ?? localOpen;
  function close() {
    setLocalOpen(false);
    onClose?.();
  }
  const current = currencyByCode(value);
  return (
    <>
      {opened === undefined ? (
      <PressableScale onPress={() => setLocalOpen(true)} style={styles.row}>
        <View>
          <Text style={styles.label}>Currency</Text>
          <Text style={styles.value}>
            {current ? `${current.flag}  ${current.name}` : value || 'Choose a currency'}
          </Text>
        </View>
        <Text style={styles.code}>{current?.code ?? value}</Text>
      </PressableScale>
      ) : null}
      <Sheet visible={open} title="Currency" onClose={close}>
        {currencies.map((item) => (
          <Pressable
            key={item.code}
            onPress={() => {
              onChange(item.code);
              close();
            }}
            style={[styles.option, item.code === value && styles.optionOn]}>
            <Text style={styles.flag}>{item.flag}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>{item.name}</Text>
              <Text style={styles.label}>{item.code}</Text>
            </View>
            {item.code === value ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

export function ChoicePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.value === value);
  return (
    <>
      <PressableScale onPress={() => setOpen(true)} style={styles.row}>
        <View>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{selected?.label ?? 'Choose'}</Text>
        </View>
        <Text style={styles.code}>›</Text>
      </PressableScale>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        {options.map((item) => (
          <Pressable
            key={item.value}
            onPress={() => {
              onChange(item.value);
              setOpen(false);
            }}
            style={[styles.option, item.value === value && styles.optionOn]}>
            <Text style={[styles.value, { flex: 1 }]}>{item.label}</Text>
            {item.value === value ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

export function TimeZonePicker({
  value,
  onChange,
  opened,
  onClose,
}: {
  value: string;
  onChange: (zone: string) => void;
  opened?: boolean;
  onClose?: () => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = opened ?? localOpen;
  function close() {
    setLocalOpen(false);
    onClose?.();
  }
  const options = useMemo(() => {
    const known = timeZones.some((item) => item[0] === value);
    return known ? timeZones : ([[value, value] as const, ...timeZones] as const);
  }, [value]);
  const label = options.find((item) => item[0] === value)?.[1] ?? value;
  return (
    <>
      {opened === undefined ? (
      <PressableScale onPress={() => setLocalOpen(true)} style={styles.row}>
        <View>
          <Text style={styles.label}>Time zone</Text>
          <Text style={styles.value}>{label}</Text>
        </View>
        <Text style={styles.code}>›</Text>
      </PressableScale>
      ) : null}
      <Sheet visible={open} title="Time zone" onClose={close}>
        {options.map(([zone, name]) => (
          <Pressable
            key={zone}
            onPress={() => {
              onChange(zone);
              close();
            }}
            style={[styles.option, zone === value && styles.optionOn]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>{name}</Text>
              <Text style={styles.label}>{zone}</Text>
            </View>
            {zone === value ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  value: { color: theme.ink, fontSize: 16, fontWeight: '700', marginTop: 2 },
  code: { color: theme.moss, fontWeight: '700', fontSize: 16 },
  option: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: theme.line,
  },
  optionOn: { borderColor: theme.moss, backgroundColor: theme.mossSoft },
  flag: { fontSize: 26 },
  check: { color: theme.moss, fontWeight: '700', fontSize: 18 },
});
