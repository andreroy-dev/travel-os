import * as FileSystem from 'expo-file-system/legacy';

import { ApiError, apiUrl } from '@/lib/api';

export type WalletDocument = {
  id: string;
  kind: string;
  title: string;
  reference: string | null;
  expires_on: string | null;
  travel_space_id: string | null;
  file_name: string | null;
  content_type: string | null;
  file_size: number | null;
  has_file: boolean;
};

export const documentKinds = [
  ['passport', 'Passport'],
  ['visa', 'Visa'],
  ['insurance', 'Travel insurance'],
  ['international_driving_permit', 'International Driving Permit'],
  ['driving_licence', 'Driving licence'],
  ['boarding_pass', 'Boarding pass'],
  ['ticket', 'Ticket'],
  ['identification', 'ID card'],
  ['vaccination', 'Vaccination record'],
  ['other', 'Other'],
] as const;

export const kindLabel: Record<string, string> = Object.fromEntries(documentKinds);

/** Upload a scan or PDF. Only the file and its type are needed. */
export async function uploadWalletFile(
  token: string,
  file: { uri: string; name: string; type: string },
  fields: { kind: string; title?: string; expires_on?: string | null; travel_space_id?: string | null },
): Promise<WalletDocument> {
  const body = new FormData();
  body.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  body.append('kind', fields.kind);
  if (fields.title?.trim()) body.append('title', fields.title.trim());
  if (fields.expires_on) body.append('expires_on', fields.expires_on);
  if (fields.travel_space_id) body.append('travel_space_id', fields.travel_space_id);
  const response = await fetch(apiUrl('/wallet/documents/upload'), {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, typeof payload?.detail === 'string' ? payload.detail : 'Could not upload that file.');
  }
  return payload as WalletDocument;
}

function extension(doc: WalletDocument) {
  if (doc.content_type === 'application/pdf') return 'pdf';
  if (doc.content_type === 'image/png') return 'png';
  if (doc.content_type?.startsWith('image/hei')) return 'heic';
  if (doc.content_type === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * A copy kept on the phone so documents open at a border with no signal (PRD 8.3).
 * Downloaded once, then reused.
 */
export async function localCopy(token: string, doc: WalletDocument): Promise<string> {
  const dir = `${FileSystem.documentDirectory}wallet/`;
  const path = `${dir}${doc.id}.${extension(doc)}`;
  const existing = await FileSystem.getInfoAsync(path);
  if (existing.exists) return path;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const result = await FileSystem.downloadAsync(apiUrl(`/wallet/documents/${doc.id}/file`), path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (result.status !== 200) {
    await FileSystem.deleteAsync(path, { idempotent: true });
    throw new ApiError(result.status, 'Could not open that document. Check your connection and try again.');
  }
  return path;
}

export async function forgetLocalCopy(doc: WalletDocument) {
  const dir = `${FileSystem.documentDirectory}wallet/`;
  await FileSystem.deleteAsync(`${dir}${doc.id}.${extension(doc)}`, { idempotent: true }).catch(() => undefined);
}
