import { sign } from "jsonwebtoken";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { prisma } from "./db";

export const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET!;
export const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET!;
export const accessTokenTTL = 60 * 15;
export const accessCookieTTL = 1000 * 60 * 15;
export const refreshTokenTTL = 60 * 60 * 24 * 7;
export const refreshCookieTTL = 1000 * 60 * 60 * 24 * 7;
const isProd = process.env.NODE_ENV === "production";

export const cookieBase = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ("none" as const) : ("lax" as const),
};

export function generateAccessToken(user: { userId: string }) {
    return sign(user, accessTokenSecret, { expiresIn: accessTokenTTL });
}

/** Issues a refresh+access pair, persists the refresh row, and sets cookies. */
export async function issueSession(req: Request, res: Response, userId: string): Promise<void> {
    const accessToken = generateAccessToken({ userId });
    const refreshToken = sign({ userId }, refreshTokenSecret, { expiresIn: refreshTokenTTL });
    const tokenHash = await hash(refreshToken, 10);
    await prisma.refreshToken.create({
        data: {
            tokenHash,
            jti: randomUUID(),
            expiresAt: new Date(Date.now() + refreshCookieTTL),
            userAgent: req.headers["user-agent"]?.slice(0, 200) ?? null,
            ip: req.ip ?? null,
            userId,
        },
    });
    res.cookie("refresh_token", refreshToken, {
        ...cookieBase,
        maxAge: refreshCookieTTL,
        path: "/auth",
    });
    res.cookie("access_token", accessToken, {
        ...cookieBase,
        maxAge: accessCookieTTL,
        path: "/",
    });
}
