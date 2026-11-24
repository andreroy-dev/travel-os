export type PhotoFields = {
  asset_key: string;
  filename: string;
  taken_on: string | null;
  latitude: number | null;
  longitude: number | null;
};

function signed(value: unknown, negativeRef: string, ref: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return null;
  return String(ref ?? '').toUpperCase() === negativeRef ? -Math.abs(number) : number;
}

function exifDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = value.match(/(\d{4}):(\d{2}):(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function fieldsFromExif(input: {
  assetId?: string | null;
  fileName?: string | null;
  uri: string;
  exif?: Record<string, unknown> | null;
}): PhotoFields {
  const exif = input.exif ?? {};
  const gps = (exif.GPS ?? exif['{GPS}'] ?? {}) as Record<string, unknown>;
  const taken = exifDate(exif.DateTimeOriginal ?? exif.DateTime);
  const filename = input.fileName?.trim() || 'photo.jpg';
  return {
    asset_key: input.assetId || `${filename}:${taken ?? input.uri}`,
    filename,
    taken_on: taken,
    latitude: signed(gps.Latitude ?? exif.GPSLatitude, 'S', gps.LatitudeRef ?? exif.GPSLatitudeRef),
    longitude: signed(gps.Longitude ?? exif.GPSLongitude, 'W', gps.LongitudeRef ?? exif.GPSLongitudeRef),
  };
}
