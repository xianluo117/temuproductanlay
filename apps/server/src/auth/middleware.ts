import type { NextFunction, Request, Response } from 'express';
import type { AuthSession } from '@temu-analytics/shared';
import { getSession } from './auth-service.js';

export const SESSION_COOKIE = 'temu_session';

export interface AuthenticatedRequest extends Request {
  auth: AuthSession;
  sessionId: string;
}

function readCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}

export function requireAuthentication(request: Request, response: Response, next: NextFunction): void {
  const sessionId = readCookies(request.headers.cookie)[SESSION_COOKIE];
  const auth = sessionId ? getSession(sessionId) : null;
  if (!sessionId || !auth) {
    response.status(401).json({ error: { code: 'UNAUTHORIZED', message: '请先登录。' } });
    return;
  }
  const authenticated = request as AuthenticatedRequest;
  authenticated.auth = auth;
  authenticated.sessionId = sessionId;
  next();
}

export function requireAdministrator(request: Request, response: Response, next: NextFunction): void {
  const authenticated = request as AuthenticatedRequest;
  if (authenticated.auth.user.role !== 'admin') {
    response.status(403).json({ error: { code: 'FORBIDDEN', message: '仅管理员可执行此操作。' } });
    return;
  }
  next();
}

export function activeOwnerId(request: Request): number {
  return (request as AuthenticatedRequest).auth.activeDataOwner.id;
}
