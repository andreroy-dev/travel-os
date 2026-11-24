import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/components/ui';

export type MapPoint = { id: string; kind: string; title: string; subtitle: string; latitude: number; longitude: number };
export type TripMapHandle = { focus: (point: MapPoint) => void };
export const pinColor: Record<string, string> = { booking: '#0f6e56', place: '#f07b4a', photo: '#5b6ee1' };

/** Native maps don't run in the browser; the list below the map still works. */
export const TripMap = forwardRef<TripMapHandle, { points: MapPoint[]; selected: string | null; onSelect: (id: string) => void }>(
  function TripMap() {
    return (
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.mossSoft }]}>
        <Text style={{ color: theme.muted }}>The map opens in the iPhone and Android app.</Text>
      </View>
    );
  },
);
