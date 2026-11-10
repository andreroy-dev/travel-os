import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useSession } from '@/lib/session';

export function AuthGate() {
  const { ready, token } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const onSignIn = segments[0] === 'sign-in';
    if (!token && !onSignIn) router.replace('/sign-in');
    if (token && onSignIn) router.replace('/');
  }, [ready, token, segments, router]);

  return null;
}
