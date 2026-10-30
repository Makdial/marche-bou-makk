import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { hasKey, translate, type Params } from '../shared/i18n';
import type { TranslationKey } from '../shared/i18n/en';

export class HttpError extends Error {
  readonly status: number;
  readonly key: TranslationKey;
  readonly params: Params;

  constructor(status: number, key: TranslationKey, params: Params = {}) {
    super(key);
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

export function idParam(value: string | string[] | undefined): number {
  const id = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'err.invalidId');
  return id;
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const localize = (message: string): string => (hasKey(message) ? translate(req.locale, message) : message);
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const field = first?.path.join('.');
    const message = localize(first?.message ?? 'err.validation');
    res.status(400).json({
      error: field ? `${field}: ${message}` : message,
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: localize(issue.message) })),
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: translate(req.locale, error.key, error.params) });
    return;
  }
  const type = (error as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: translate(req.locale, 'err.badJson') });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: translate(req.locale, 'err.tooLarge') });
    return;
  }
  console.error(error);
  res.status(500).json({ error: translate(req.locale, 'err.serverError') });
}
