import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, ErrorNote, Muted, Screen, theme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

type Turn = { role: 'user' | 'assistant'; content: string };

export default function CompanionScreen() {
  const { token } = useSession();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const message = draft.trim();
    if (!message || !token) return;
    setDraft('');
    setTurns((current) => [...current, { role: 'user', content: message }]);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ conversation_id: string; reply: string; used_model: boolean }>(
        '/ai/chat',
        {
          token,
          body: {
            message,
            conversation_id: conversationId,
          },
        },
      );
      setConversationId(result.conversation_id);
      setTurns((current) => [...current, { role: 'assistant', content: result.reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The companion could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen safeTop>
        <Text style={styles.heading}>Travel Companion</Text>
        <Muted>Answers use your saved spaces, bookings, and itinerary. Prices and places are not invented.</Muted>
        <View style={styles.chips}>
          {['What is planned today?', 'Where am I staying?', 'Which flights are saved?'].map((prompt) => (
            <Pressable key={prompt} onPress={() => setDraft(prompt)} style={styles.chip}>
              <Text>{prompt}</Text>
            </Pressable>
          ))}
        </View>
        {turns.length === 0 ? (
          <Card>
            <Muted>Try “What do I have planned today?” or “Where am I staying?”</Muted>
          </Card>
        ) : (
          turns.map((turn, index) => (
            <View key={`${turn.role}-${index}`} style={turn.role === 'user' ? styles.user : styles.assistant}>
              <Text style={[styles.copy, turn.role === 'user' && styles.userCopy]}>{turn.content}</Text>
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
    borderRadius: 12,
    padding: 12,
    color: theme.ink,
    fontSize: 16,
  },
});
