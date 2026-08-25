import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  authenticateUser,
  changePassword,
  createSession,
  deleteSession,
  listUsers,
  registerUser,
  resetUserPassword,
  setActiveOwner,
  updateUser,
} from './auth-service.js';
import { config } from '../config.js';
import {
  type AuthenticatedRequest,
  requireAdministrator,
  requireAuthentication,
  SESSION_COOKIE,
} from './middleware.js';

export const authRouter = Router();

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
const userIdSchema = z.coerce.number().int().positive();

function setSessionCookie(response: Response, id: string, expiresAt: Date): void {
  response.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.sessionSecureCookie,
    path: '/',
    expires: expiresAt,
  });
}

authRouter.post('/register', (request, response, next) => {
  try {
    const user = registerUser(credentialsSchema.parse(request.body));
    const session = createSession(user.id);
    setSessionCookie(response, session.id, session.expiresAt);
    response.status(201).json({ data: { user, activeDataOwner: user } });
  } catch (error) { next(error); }
});

authRouter.post('/login', (request, response, next) => {
  try {
    const user = authenticateUser(credentialsSchema.parse(request.body));
    const session = createSession(user.id);
    setSessionCookie(response, session.id, session.expiresAt);
    response.json({ data: { user, activeDataOwner: user } });
  } catch (error) { next(error); }
});

authRouter.use(requireAuthentication);

authRouter.get('/session', (request, response) => {
  response.json({ data: (request as AuthenticatedRequest).auth });
});

authRouter.post('/logout', (request, response) => {
  deleteSession((request as AuthenticatedRequest).sessionId);
  response.clearCookie(SESSION_COOKIE, { path: '/' });
  response.status(204).end();
});

authRouter.put('/password', (request, response, next) => {
  try {
    const authenticated = request as AuthenticatedRequest;
    changePassword(authenticated.auth.user.id, passwordSchema.parse(request.body));
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.status(204).end();
  } catch (error) { next(error); }
});

authRouter.put('/active-owner/:id', requireAdministrator, (request, response, next) => {
  try {
    const authenticated = request as AuthenticatedRequest;
    response.json({ data: setActiveOwner(authenticated.sessionId, authenticated.auth.user, userIdSchema.parse(request.params.id)) });
  } catch (error) { next(error); }
});

authRouter.get('/users', requireAdministrator, (_request, response) => {
  response.json({ data: listUsers() });
});

authRouter.patch('/users/:id', requireAdministrator, (request, response, next) => {
  try {
    const parsed = z.object({
      role: z.enum(['admin', 'user']).optional(),
      enabled: z.boolean().optional(),
    }).parse(request.body);
    const input = {
      ...('role' in parsed && parsed.role !== undefined ? { role: parsed.role } : {}),
      ...('enabled' in parsed && parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
    };
    const authenticated = request as AuthenticatedRequest;
    response.json({ data: updateUser(authenticated.auth.user.id, userIdSchema.parse(request.params.id), input) });
  } catch (error) { next(error); }
});

authRouter.post('/users/:id/reset-password', requireAdministrator, (request, response, next) => {
  try {
    const input = z.object({ newPassword: z.string().min(8).max(128) }).parse(request.body);
    resetUserPassword(userIdSchema.parse(request.params.id), input);
    response.status(204).end();
  } catch (error) { next(error); }
});
