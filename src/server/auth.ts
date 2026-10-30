import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, UserStatus } from '../shared/types';
import { config } from './config';
import { sql } from './db';
import { HttpError } from './http';

export interface AuthUser {
  id: number;
  role: Role;
  name: string;
  email: string;
  status: UserStatus;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function signToken(userId: number, role: Role): string {
  return jwt.sign({ role }, config.jwtSecret, { subject: String(userId), expiresIn: '7d' });
}

function userFromToken(token: string): AuthUser | null {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
  if (typeof payload === 'string' || !payload.sub) return null;
  return sql.get<AuthUser>('SELECT id, role, name, email, status FROM users WHERE id = ?', Number(payload.sub)) ?? null;
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const queryToken = req.path.endsWith('/stream') && typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
  if (!token) return next(new HttpError(401, 'err.signIn'));
  const user = userFromToken(token);
  if (!user) return next(new HttpError(401, 'err.sessionExpired'));
  if (user.status === 'suspended') return next(new HttpError(403, 'err.suspended'));
  req.user = user;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const user = userFromToken(header.slice(7));
    if (user && user.status !== 'suspended') req.user = user;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'err.noAccess'));
    }
    next();
  };
}

export function requireActive(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.status !== 'active') {
    return next(new HttpError(403, 'err.awaitingApproval'));
  }
  next();
}
