import type { Provenance } from '@ghayarly/shared';
import type { Tone } from '@/ui';

/** Clinician-verified reads strongest, then document-imported, then self/caregiver-reported. */
export function provenanceTone(p: Provenance | null): Tone {
  return p === 'PROFESSIONALLY_VERIFIED' ? 'success' : p === 'IMPORTED_DOCUMENT' ? 'info' : 'neutral';
}
