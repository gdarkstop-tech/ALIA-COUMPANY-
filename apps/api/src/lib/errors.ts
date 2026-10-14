export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Authentication required');
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this resource') => new AppError(403, code, message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message?: string) => new AppError(409, code, message);
export const unprocessable = (code: string, message?: string, details?: unknown) => new AppError(422, code, message, details);

type PgError = { code?: string; message?: string; detail?: string; constraint?: string };

/** Translate PostgreSQL errors (RLS violations, guard triggers, constraints) into safe API errors. */
export function fromPgError(err: unknown): AppError | null {
  const e = err as PgError & { cause?: PgError };
  const pg = e?.code ? e : e?.cause?.code ? e.cause : null;
  if (!pg?.code) return null;
  const message = pg.message ?? '';
  switch (pg.code) {
    case '42501': // insufficient_privilege — includes RLS WITH CHECK violations and guard triggers
      return new AppError(403, /^[A-Z_]+$/.test(message) ? message : 'FORBIDDEN', 'This action is not permitted');
    case 'P0001': // raise_exception from guard functions: message is a stable error code
      return new AppError(422, /^[A-Z_]+$/.test(message) ? message : 'RULE_VIOLATION', message, pg.detail ? { detail: pg.detail } : undefined);
    case 'P0002':
      return new AppError(404, /^[A-Z_]+$/.test(message) ? message : 'NOT_FOUND', 'Not found');
    case '23505':
      return new AppError(409, /^[A-Z_]+$/.test(message) ? message : 'ALREADY_EXISTS', 'Already exists');
    case '23503':
      return new AppError(422, 'INVALID_REFERENCE', 'Referenced record does not exist');
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
      return new AppError(422, 'INVALID_VALUE', 'One or more values are invalid', pg.constraint ? { constraint: pg.constraint } : undefined);
    default:
      return null;
  }
}
