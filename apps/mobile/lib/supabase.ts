import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Supabase Auth client, or null when the app is built without Supabase keys
 * (then only the developer email sign-in is offered).
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: Platform.OS === 'web' ? undefined : AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: Platform.OS === 'web',
          flowType: 'pkce',
        },
      })
    : null;

// Refresh tokens only while the app is in the foreground (Supabase's React Native guidance).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
