import { Card, Muted, Screen, theme } from '@/components/ui';
import { StyleSheet, Text } from 'react-native';

export default function DiscoverScreen() {
  return (
    <Screen safeTop>
      <Text style={styles.title}>Discover</Text>
      <Muted>Anything, anywhere — travel and everyday life</Muted>
      <Card>
        <Text style={styles.cardTitle}>Listings are not connected yet</Text>
        <Muted>
          Search, prices, and “verified” places will show up here only after a provider is connected. This screen will not invent cafes, gyms, or rates.
        </Muted>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: '700', color: theme.ink },
  cardTitle: { fontSize: 18, fontWeight: '700', color: theme.ink },
});
