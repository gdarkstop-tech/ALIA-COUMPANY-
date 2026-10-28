/**
 * The one request shape used to read a lab report, shared by production and the evaluation suite
 * so a model is approved on exactly what patients' documents are sent with.
 */
import { LAB_EXTRACTION_JSON_SCHEMA, labExtractionSchema, type DocumentContentType, type LabExtraction } from '@ghayarly/shared';
import type { AiRequest } from '../../integrations/ai';
import { LAB_EXTRACTION_POLICY } from '../ai/safety';

export const LAB_READING_INSTRUCTION = 'Read the results table of the attached document and return it as JSON.';

export function labReadingRequest(
  doc: { contentType: DocumentContentType; bytes: Buffer },
): Pick<AiRequest, 'system' | 'messages' | 'attachments' | 'jsonSchema'> {
  return {
    system: LAB_EXTRACTION_POLICY,
    messages: [{ role: 'user', content: LAB_READING_INSTRUCTION }],
    attachments: [{ contentType: doc.contentType, data: doc.bytes, filename: doc.contentType === 'application/pdf' ? 'report.pdf' : 'report' }],
    jsonSchema: { name: 'lab_report', schema: LAB_EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown> },
  };
}

/** The model's output is untrusted: valid JSON matching the schema, or null. */
export function parseLabReading(text: string): LabExtraction | null {
  try {
    const r = labExtractionSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
