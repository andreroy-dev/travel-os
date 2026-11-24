import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

export type MapPoint = { id: string; kind: string; title: string; subtitle: string; latitude: number; longitude: number };
export type TripMapHandle = { focus: (point: MapPoint) => void };

export const pinColor: Record<string, string> = {
  booking: '#0f6e56',
  place: '#f07b4a',
  photo: '#5b6ee1',
};

/** Native map: Apple Maps on iOS, Google Maps on Android. No web view, no third-party tiles. */
export const TripMap = forwardRef<TripMapHandle, { points: MapPoint[]; selected: string | null; onSelect: (id: string) => void }>(
  function TripMap({ points, selected, onSelect }, ref) {
    const map = useRef<MapView>(null);

    useImperativeHandle(ref, () => ({
      focus: (point) =>
        map.current?.animateToRegion(
          { latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 },
          350,
        ),
    }));

    const key = points.map((p) => p.id).join(',');
    useEffect(() => {
      if (points.length === 0) return;
      const timer = setTimeout(() => {
        map.current?.fitToCoordinates(
          points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
          { edgePadding: { top: 90, right: 50, bottom: 60, left: 50 }, animated: true },
        );
      }, 250);
      return () => clearTimeout(timer);
      // Refit only when the set of points changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return (
      <MapView ref={map} style={StyleSheet.absoluteFill} showsPointsOfInterests={false} showsCompass={false}>
        {points.map((point) => (
          <Marker
            key={`${point.id}-${selected === point.id}`}
            coordinate={{ latitude: point.latitude, longitude: point.longitude }}
            title={point.title}
            description={point.subtitle}
            pinColor={pinColor[point.kind] ?? '#0f6e56'}
            opacity={selected && selected !== point.id ? 0.7 : 1}
            onPress={() => onSelect(point.id)}
          />
        ))}
      </MapView>
    );
  },
);
