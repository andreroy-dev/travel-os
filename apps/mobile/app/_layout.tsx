import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SignInScreen from '@/app/sign-in';
import { serif, theme } from '@/components/ui';
import { useSession, SessionProvider } from '@/lib/session';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
    <SessionProvider>
      <View
        style={{
          flex: 1,
          width: '100%',
          minHeight: Platform.OS === 'web' ? '100vh' : undefined,
          backgroundColor: theme.paper,
        }}>
        <RootNavigator />
      </View>
    </SessionProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { ready, token } = useSession();
  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.paper }} />;
  if (!token) return <SignInScreen />;

  return (
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.paper },
          headerShadowVisible: false,
          headerTintColor: theme.ink,
          headerTitleStyle: { fontFamily: serif, fontSize: 18 },
          contentStyle: { backgroundColor: theme.paper },
          headerBackTitle: Platform.OS === 'ios' ? 'Back' : undefined,
          animation: 'slide_from_right',
          animationDuration: 280,
          gestureEnabled: true,
          fullScreenGestureEnabled: Platform.OS === 'ios',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="new-space" options={{ title: 'New space', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="spaces/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="new-booking" options={{ title: 'Add booking', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="import-confirmation" options={{ title: 'Import', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="gmail" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="bookings/[id]" options={{ title: 'Booking' }} />
        <Stack.Screen name="merge-space" options={{ title: 'Merge spaces' }} />
        <Stack.Screen name="add-journey" options={{ title: 'Add travel', presentation: 'modal' }} />
        <Stack.Screen name="add-stay" options={{ title: 'Where are you staying?', presentation: 'modal' }} />
        <Stack.Screen name="living/[id]" options={{ title: 'Living' }} />
        <Stack.Screen name="memories/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="expenses" options={{ title: 'Expenses' }} />
        <Stack.Screen name="map" options={{ headerShown: false }} />
        <Stack.Screen name="document/[id]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="trip-bookings" options={{ title: 'Bookings' }} />
        <Stack.Screen name="wallet" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="tools" options={{ title: '', headerBackTitle: 'Back' }} />
      </Stack>
  );
}
