import { ReactNode, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/components/motion';
import { theme } from '@/components/ui';

export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(visible);
  const y = useSharedValue(reduced ? 0 : 480);
  const dim = useSharedValue(0);
  // The sheet rides on top of the keyboard, so the field being typed in stays visible.
  const keyboard = useAnimatedKeyboard();
  const bottomInset = insets.bottom + 16;
  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    bottom: keyboard.height.value,
    paddingBottom: keyboard.height.value > 0 ? 16 : bottomInset,
  }));
  const scrim = useAnimatedStyle(() => ({ opacity: dim.value }));

  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    setShown(true);
    y.value = reduced ? 0 : 480;
    y.value = reduced ? 0 : withSpring(0, { damping: 24, stiffness: 260, mass: 0.8 });
    dim.value = withTiming(1, { duration: reduced ? 0 : 220 });
  }, [dim, reduced, visible, y]);

  function finish() {
    setShown(false);
    onClose();
  }

  function dismiss() {
    dim.value = withTiming(0, { duration: reduced ? 0 : 180 });
    y.value = withTiming(reduced ? 0 : 520, { duration: reduced ? 0 : 240 }, (done) => {
      if (done) runOnJS(finish)();
    });
  }

  if (!shown && !visible) return null;

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.fill}>
        <Animated.View style={[styles.scrim, scrim]}>
          <Pressable style={styles.fill} onPress={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.sheet, panel]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={dismiss} hitSlop={12}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets={false}
            contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20, 33, 28, 0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    backgroundColor: theme.paper,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    gap: 8,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 99, backgroundColor: '#c9d5ce' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  title: { fontSize: 20, fontWeight: '700', color: theme.ink },
  close: { color: theme.moss, fontWeight: '700', fontSize: 16 },
  body: { padding: 20, gap: 12, paddingBottom: 28 },
});
