import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import type { User } from '@/lib/types';

const TOKEN_KEY = 'travelos.token';

type SessionValue = {
  ready: boolean;
  token: string | null;
  user: User | null;
  signIn: (email: string, displayName: string) => Promise<void>;
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

  const signIn = useCallback(async (email: string, displayName: string) => {
    const result = await api<{ access_token: string }>('/auth/dev-login', {
      body: { email: email.trim(), display_name: displayName.trim() },
    });
    await writeToken(result.access_token);
    setToken(result.access_token);
    setUser(await api<User>('/users/me', { token: result.access_token }));
  }, []);

  const signOut = useCallback(async () => {
    await writeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ ready, token, user, signIn, signOut, refreshUser }),
    [ready, token, user, signIn, signOut, refreshUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session is missing.');
  return value;
}
