import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES, type DocumentContentType } from '@ghayarly/shared';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

export type PickedDocument = { name: string; contentType: DocumentContentType; base64: string; size: number };
export type PickOutcome = { ok: true; file: PickedDocument } | { ok: false; reason: 'tooLarge' | 'unsupported' | 'readFailed' } | null;

const BY_EXTENSION: Record<string, DocumentContentType> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const isSupported = (t: string | undefined): t is DocumentContentType => Boolean(t && (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(t));

/**
 * Lets the person choose one report (PDF or photo) and reads it as base64 for upload. The type
 * shown here is only a hint: the server identifies the file from its bytes.
 */
export async function pickDocument(): Promise<PickOutcome> {
  const r = await DocumentPicker.getDocumentAsync({ type: [...DOCUMENT_CONTENT_TYPES], copyToCacheDirectory: true, multiple: false, base64: Platform.OS === 'web' });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const type = isSupported(a.mimeType) ? a.mimeType : BY_EXTENSION[a.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) return { ok: false, reason: 'unsupported' };
  if ((a.size ?? 0) > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'tooLarge' };
  try {
    // Web returns a data URL; native reads the cached copy.
    const base64 = Platform.OS === 'web' ? (a.base64 ?? '').replace(/^data:[^,]*,/, '') : await new File(a.uri).base64();
    const size = a.size ?? Math.floor((base64.length * 3) / 4);
    if (!base64) return { ok: false, reason: 'readFailed' };
    if (size > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'tooLarge' };
    return { ok: true, file: { name: a.name, contentType: type, base64, size } };
  } catch {
    return { ok: false, reason: 'readFailed' };
  }
}
