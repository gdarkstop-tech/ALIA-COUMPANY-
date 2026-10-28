import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type PickedPhoto = { contentType: 'image/jpeg' | 'image/png'; base64: string; capturedAt?: string };
export type PhotoOutcome = { ok: true; photo: PickedPhoto } | { ok: false; reason: 'unavailable' | 'denied' | 'unsupported' | 'tooLarge' | 'readFailed' } | null;
type Picker = typeof import('expo-image-picker');

const MAX_BYTES = 12 * 1024 * 1024;
let picker: Picker | null | undefined;

/**
 * Wound photos ship only in builds that link the picker (development / preview; ADR 0015). The
 * module is loaded lazily so a production build — which does not contain it — never touches it.
 */
export function woundPhotosAvailable(): boolean {
  return Platform.OS === 'web' || Boolean(Constants.expoConfig?.extra?.woundPhotosEnabled);
}
/** The camera is offered on native builds only (the web harness uses the file picker). */
export const cameraAvailable = () => Platform.OS !== 'web' && woundPhotosAvailable();

function load(): Picker | null {
  if (picker !== undefined) return picker;
  if (!woundPhotosAvailable()) return (picker = null);
  try {
    picker = require('expo-image-picker') as Picker;
  } catch {
    picker = null;
  }
  return picker;
}

/** "2026:10:20 08:15:00" → ISO, read on the device before the photo leaves it (the server strips metadata). */
function exifTime(exif: Record<string, unknown> | null | undefined): string | undefined {
  const v = exif?.DateTimeOriginal ?? exif?.DateTime;
  const m = typeof v === 'string' ? v.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/) : null;
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Takes or chooses ONE photo. No cropping or editing: the photo is medical evidence. The system
 * photo picker is used (no access to the rest of the library); the camera asks for permission only
 * when the person taps "Take a photo", after the disclosure in the app.
 */
export async function pickWoundPhoto(source: 'camera' | 'library'): Promise<PhotoOutcome> {
  const ip = load();
  if (!ip) return { ok: false, reason: 'unavailable' };
  const options = {
    mediaTypes: ['images'] as ('images')[],
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 0.9,
    base64: true,
    exif: true,
    preferredAssetRepresentationMode: ip.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  };
  let r: Awaited<ReturnType<Picker['launchImageLibraryAsync']>>;
  if (source === 'camera') {
    const perm = await ip.requestCameraPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    r = await ip.launchCameraAsync(options);
  } else {
    r = await ip.launchImageLibraryAsync(options);
  }
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const type = a.mimeType === 'image/png' ? 'image/png' : a.mimeType === 'image/jpeg' || a.mimeType === 'image/jpg' || !a.mimeType ? 'image/jpeg' : null;
  if (!type) return { ok: false, reason: 'unsupported' };
  const base64 = (a.base64 ?? '').replace(/^data:[^,]*,/, '');
  if (!base64) return { ok: false, reason: 'readFailed' };
  if ((base64.length * 3) / 4 > MAX_BYTES) return { ok: false, reason: 'tooLarge' };
  return { ok: true, photo: { contentType: type, base64, capturedAt: exifTime(a.exif as Record<string, unknown> | null) } };
}
