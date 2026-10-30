import { Router } from 'express';
import { authenticate, signToken } from '../auth';
import {
  checkCredentials,
  loadMe,
  loginSchema,
  profileSchema,
  registerAccount,
  registerSchema,
  updateProfile,
} from '../accounts';

export const authRouter = Router();

authRouter.post('/register', (req, res) => {
  const input = registerSchema.parse(req.body);
  const userId = registerAccount(input);
  res.status(201).json({ token: signToken(userId, input.role), user: loadMe(userId) });
});

authRouter.post('/login', (req, res) => {
  const input = loginSchema.parse(req.body);
  const userId = checkCredentials(input.email, input.password);
  const user = loadMe(userId);
  res.json({ token: signToken(userId, user.role), user });
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: loadMe(req.user!.id) });
});

authRouter.patch('/me', authenticate, (req, res) => {
  res.json({ user: updateProfile(req.user!.id, profileSchema.parse(req.body)) });
});
