import type { z } from 'zod';

/** Parses untrusted input; ZodError is translated to a 400 by the global error handler. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input ?? {});
}
