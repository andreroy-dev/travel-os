import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { TravelSpace } from '@/lib/types';

type Proposal = {
  kind: 'add_stay' | 'add_plan' | 'save_place';
  title: string;
  travel_space_id: string;
  start_date?: string | null;
  end_date?: string | null;
  starts_on?: string | null;
};

type Turn = { role: 'user' | 'assistant'; content: string; proposal?: Proposal | null };

export default function CompanionScreen() {
  const { token } = useSession();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      api<TravelSpace[]>('/travel-spaces', { token })
        .then((rows) => {
          const open = rows.filter((space) => space.status !== 'archived');
          setSpaces(open);
          setSpaceId((current) => current ?? open.find((space) => space.start_date)?.id ?? open[0]?.id ?? null);
        })
        .catch(() => undefined);
    }, [token]),
  );

  async function confirm(proposal: Proposal) {
    if (!token) return;
    setError(null);
    try {
      if (proposal.kind === 'add_stay') {
        await api('/stays', {
          token,
          body: {
            travel_space_id: proposal.travel_space_id,
            title: proposal.title,
            start_date: proposal.start_date,
            end_date: proposal.end_date,
          },
        });
      } else if (proposal.kind === 'add_plan') {
        await api('/itinerary/plans', {
          token,
          body: {
            travel_space_id: proposal.travel_space_id,
            title: proposal.title,
            starts_on: proposal.starts_on,
          },
        });
      } else {
        await api('/saved-places', {
          token,
          body: { name: proposal.title, travel_space_id: proposal.travel_space_id },
        });
      }
      setTurns((current) => [...current, { role: 'assistant', content: `Saved ${proposal.title}.` }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.');
    }
  }

  async function send() {
    const message = draft.trim();
    if (!message || !token) return;
    setDraft('');
    setTurns((current) => [...current, { role: 'user', content: message }]);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
        conversation_id: string;
        reply: string;
        used_model: boolean;
        proposal: Proposal | null;
      }>('/ai/chat', {
        token,
        body: {
          message,
          conversation_id: conversationId,
          travel_space_id: spaceId,
        },
      });
      setConversationId(result.conversation_id);
      setTurns((current) => [...current, { role: 'assistant', content: result.reply, proposal: result.proposal }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The companion could not answer.');
    } finally {
      setBusy(false);
    }
  }

  const space = spaces.find((item) => item.id === spaceId);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen safeTop>
        <Text style={styles.heading}>Travel Companion</Text>
        <Muted>
          {space
            ? `Context: ${space.title}. A change is saved only when you confirm it.`
            : 'Answers come from your trips, bookings, and notes.'}
        </Muted>
        {spaces.length > 1 ? (
          <View style={styles.chips}>
            {spaces.map((item) => (
              <Pressable key={item.id} onPress={() => { setSpaceId(item.id); setConversationId(null); }} style={styles.chip}>
                <Text>{item.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.chips}>
          {["What's planned tomorrow?", 'Which nights are open?', 'How much have I spent?'].map((prompt) => (
            <Pressable key={prompt} onPress={() => setDraft(prompt)} style={styles.chip}>
              <Text>{prompt}</Text>
            </Pressable>
          ))}
        </View>
        {turns.length === 0 ? (
          <Card>
            <Muted>Ask about a saved trip, or say “Add a museum on 2027-03-04”.</Muted>
          </Card>
        ) : (
          turns.map((turn, index) => (
            <View key={`${turn.role}-${index}`} style={turn.role === 'user' ? styles.user : styles.assistant}>
              <Text style={[styles.copy, turn.role === 'user' && styles.userCopy]}>{turn.content}</Text>
              {turn.proposal ? (
                <View style={styles.confirm}>
                  <Text style={styles.confirmTitle}>Confirm action</Text>
                  <Text style={styles.copy}>
                    {turn.proposal.kind === 'add_plan'
                      ? `Add “${turn.proposal.title}” to the plan?`
                      : turn.proposal.kind === 'save_place'
                        ? `Save “${turn.proposal.title}” as a place?`
                        : `Add the stay “${turn.proposal.title}”?`}
                  </Text>
                  <View style={styles.confirmRow}>
                    <Pressable onPress={() => setTurns((current) => current.map((item) => (item === turn ? { ...item, proposal: null } : item)))} style={styles.cancel}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={() => turn.proposal && confirm(turn.proposal)} style={styles.confirmButton}>
                      <Text style={styles.confirmText}>Confirm</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          ))
        )}
        <ErrorNote message={error} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about what is saved"
          placeholderTextColor="#a3988b"
          style={styles.input}
        />
        <Button label={busy ? 'Thinking' : 'Send'} onPress={send} busy={busy} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  user: {
    alignSelf: 'flex-end',
    backgroundColor: theme.moss,
    borderRadius: 16,
    padding: 12,
    maxWidth: '88%',
  },
  assistant: {
    alignSelf: 'flex-start',
    backgroundColor: theme.card,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    maxWidth: '88%',
  },
  copy: { color: theme.ink, fontSize: 16, lineHeight: 22 },
  userCopy: { color: '#fffdf8' },
  heading: { fontSize: 28, fontWeight: '700', color: theme.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.line },
  input: {
    backgroundColor: theme.card,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: theme.ink,
    fontSize: 16,
  },
  confirm: { marginTop: 8, backgroundColor: theme.coralSoft, borderRadius: 16, padding: 12, gap: 8 },
  confirmTitle: { color: theme.clay, fontWeight: '700' },
  confirmRow: { flexDirection: 'row', gap: 8 },
  cancel: { flex: 1, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: theme.ink, fontWeight: '700' },
  confirmButton: { flex: 1, backgroundColor: theme.clay, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '700' },
});
