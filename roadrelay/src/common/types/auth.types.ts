export type UserRole = 'user' | 'moderator' | 'admin';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  trustScore: number;
  status: 'pending' | 'active' | 'suspended' | 'banned' | 'deleted';
  deviceId?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
    requestId?: string;
  }
}
