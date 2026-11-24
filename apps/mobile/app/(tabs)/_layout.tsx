import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useReducedMotion } from '@/components/motion';
import { theme } from '@/components/ui';

function icon(name: SFSymbol) {
  return ({ focused }: { focused: boolean }) => <TabIcon name={name} focused={focused} />;
}

function TabIcon({ name, focused }: { name: SFSymbol; focused: boolean }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(focused ? 1 : 0.92);
  useEffect(() => {
    scale.value = reduced ? 1 : withSpring(focused ? 1 : 0.92, { damping: 14, stiffness: 260 });
  }, [focused, reduced, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={animated}>
      <SymbolView name={name} tintColor={focused ? theme.moss : theme.muted} size={22} />
    </Animated.View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.moss,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: theme.line,
          height: Platform.OS === 'ios' ? 88 : 64,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: theme.paper },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('house.fill') }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: icon('magnifyingglass') }} />
      <Tabs.Screen
        name="companion"
        options={{
          title: '',
          tabBarIcon: () => (
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: theme.clay,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}>
              <SymbolView name="sparkles" tintColor="#fff" size={24} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="trips" options={{ title: 'Trips', tabBarIcon: icon('briefcase.fill') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person.fill') }} />
    </Tabs>
  );
}
