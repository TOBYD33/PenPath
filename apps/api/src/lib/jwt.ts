import jwt from "jsonwebtoken";
import type { Role } from "@penpath/shared";
import { env } from "./env.js";

export interface AuthTokenPayload {
  sub: string; // user id
  role: Role;
  email: string;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}
