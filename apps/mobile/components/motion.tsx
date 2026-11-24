import { ReactNode, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleProp,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const springIn = { damping: 16, stiffness: 380, mass: 0.4 };
const springOut = { damping: 14, stiffness: 240, mass: 0.45 };

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export function PressableScale({
  children,
  onPress,
  style,
  disabled,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        scale.value = reduced ? 1 : withSpring(0.97, springIn);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, springOut);
      }}
      style={[style, animated]}>
      {children}
    </AnimatedPressable>
  );
}

export function Appear({ children, index = 0 }: { children: ReactNode; index?: number }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  const y = useSharedValue(reduced ? 0 : 12);
  useEffect(() => {
    const delay = reduced ? 0 : Math.min(index, 8) * 40;
    opacity.value = withDelay(delay, withTiming(1, { duration: 240 }));
    y.value = withDelay(delay, withSpring(0, { damping: 18, stiffness: 180 }));
  }, [index, opacity, reduced, y]);
  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));
  return <Animated.View style={animated}>{children}</Animated.View>;
}

export function FadePanel({ panelKey, children }: { panelKey: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      x.value = 0;
      return;
    }
    opacity.value = 0.35;
    x.value = 10;
    opacity.value = withTiming(1, { duration: 200 });
    x.value = withSpring(0, { damping: 20, stiffness: 220 });
  }, [panelKey, opacity, reduced, x]);
  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }],
  }));
  return <Animated.View style={[{ gap: 14 }, animated]}>{children}</Animated.View>;
}

export function SkeletonBlock({ height = 76 }: { height?: number }) {
  const reduced = useReducedMotion();
  const shift = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    shift.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduced, shift]);
  const shine = useAnimatedStyle(() => ({
    opacity: reduced ? 0.35 : 0.25 + shift.value * 0.55,
    transform: [{ translateX: reduced ? 0 : (shift.value - 0.5) * 140 }],
  }));
  return (
    <View style={{ height, borderRadius: 18, backgroundColor: '#e4ece7', overflow: 'hidden' }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '50%',
            backgroundColor: 'rgba(255,255,255,0.75)',
          },
          shine,
        ]}
      />
    </View>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBlock key={index} height={index === 0 ? 108 : 78} />
      ))}
    </View>
  );
}

export function SharedTitle({
  tag,
  style,
  children,
}: {
  tag?: string;
  style?: StyleProp<TextStyle>;
  children: string;
}) {
  const reduced = useReducedMotion();
  const shared = !reduced && tag && Platform.OS !== 'web' ? tag : undefined;
  return (
    <Animated.Text sharedTransitionTag={shared} style={style}>
      {children}
    </Animated.Text>
  );
}

export function ShakeNote({ message }: { message: string }) {
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const opacity = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 160 });
    if (reduced) return;
    x.value = withSequence(withTiming(-7, { duration: 45 }), withSpring(0, { damping: 8, stiffness: 280 }));
  }, [message, opacity, reduced, x]);
  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }],
  }));
  return (
    <Animated.Text style={[{ color: '#c2412d', fontSize: 14, lineHeight: 20 }, animated]}>{message}</Animated.Text>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Appear>
      <View style={{ backgroundColor: '#e7f3ee', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text style={{ color: '#0c5c48', fontWeight: '700' }}>{message}</Text>
      </View>
    </Appear>
  );
}
