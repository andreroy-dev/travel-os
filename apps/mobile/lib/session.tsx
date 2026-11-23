import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { User } from '@/lib/types';

const TOKEN_KEY = 'travelos.token';

type SessionValue = {
  ready: boolean;
  token: string | null;
  user: User | null;
  /** Developer email-only sign-in (servers in development mode only). */
  signIn: (email: string, displayName: string) => Promise<void>;
  /** True when the app was built with Supabase keys (real sign-in). */
  realAuth: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

async function readToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function writeToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

function webToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const initialToken = Platform.OS === 'web' ? webToken() : null;
  const [ready, setReady] = useState(Platform.OS === 'web' && !initialToken);
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<User | null>(null);

  const refreshUser = useCallback(async () => {
    const current = token ?? (await readToken());
    if (!current) {
      setUser(null);
      return;
    }
    const me = await api<User>('/users/me', { token: current });
    setUser(me);
  }, [token]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = Platform.OS === 'web' ? webToken() : await readToken();
        if (!active) return;
        setToken(stored);
        if (stored) {
          try {
            setUser(await api<User>('/users/me', { token: stored }));
          } catch {
            await writeToken(null);
            if (active) setToken(null);
          }
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Real sign-in: the Supabase session's access token is what the API accepts.
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = async (accessToken: string | null) => {
      if (!active) return;
      if (!accessToken) return;
      setToken(accessToken);
      try {
        setUser(await api<User>('/users/me', { token: accessToken }));
      } catch {
        // Keep the session; the next screen load will show the error.
      }
      if (active) setReady(true);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session?.access_token ?? null));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setToken(null);
        setUser(null);
        return;
      }
      void apply(session?.access_token ?? null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, displayName: string) => {
    const result = await api<{ access_token: string }>('/auth/dev-login', {
      body: { email: email.trim(), display_name: displayName.trim()},
    });
    await writeToken(result.access_token);
    setToken(result.access_token);
    setUser(await api<User>('/users/me', { token: result.access_token }));
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut().catch(() => undefined);
    await writeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ ready, token, user, signIn, signOut, refreshUser, realAuth: supabase !== null }),
    [ready, token, user, signIn, signOut, refreshUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session is missing.');
  return value;
}
