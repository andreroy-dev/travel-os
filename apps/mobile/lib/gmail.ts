import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { api } from '@/lib/api';
import type { Integration } from '@/lib/types';

export function loadGmail(token: string) {
  return api<Integration>('/integrations/gmail', { token });
}

/**
 * Open Google's consent screen. Google shows its account chooser every time,
 * so the same call connects the first inbox or adds another one.
 * Returns the accounts afterwards and the address that was just added, if any.
 */
export async function connectGmail(token: string): Promise<{ gmail: Integration; added: string | null }> {
  const before = await loadGmail(token).catch(() => null);
  const returnTo = Linking.createURL('/gmail');
  const result = await api<{ authorization_url: string }>('/integrations/gmail/connect', {
    method: 'POST',
    token,
    body: { return_to: returnTo },
  });
  await WebBrowser.openAuthSessionAsync(result.authorization_url, returnTo);
  const gmail = await loadGmail(token);
  const known = new Set((before?.accounts ?? []).filter((a) => a.status === 'connected').map((a) => a.id));
  const added = gmail.accounts.find((a) => a.status === 'connected' && !known.has(a.id));
  return { gmail, added: added ? added.email ?? 'Gmail' : null };
}

export function accountName(email: string | null) {
  return email ?? 'Gmail account';
}
