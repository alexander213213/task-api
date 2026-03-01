"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = require("jsonwebtoken");
const express_1 = __importDefault(require("express"));
const bcrypt_1 = require("bcrypt");
const zod_1 = __importDefault(require("zod"));
const db_1 = require("../services/db");
const authorize_1 = require("../middlewares/authorize");
const router = express_1.default.Router();
const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;
const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET;
const accessTokenTTL = 60 * 15;
const accessCookieTTL = 1000 * 60 * 15;
const refreshTokenTTL = 60 * 60 * 24 * 7;
const refreshCookieTTL = 1000 * 60 * 60 * 24 * 7;
const isProd = process.env.NODE_ENV === "production";
const cookieBase = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
};
const registrationSchema = zod_1.default.object({
    username: zod_1.default.string(),
    email: zod_1.default.email().toLowerCase(),
    firstName: zod_1.default.string().toLowerCase(),
    lastName: zod_1.default.string().toLowerCase(),
    middleName: zod_1.default.string().toLowerCase().optional(),
    password: zod_1.default.string().min(8)
});
const emailSchema = zod_1.default.object({
    email: zod_1.default.email().toLowerCase(),
    password: zod_1.default.string()
});
const usernameSchema = zod_1.default.object({
    username: zod_1.default.string(),
    password: zod_1.default.string()
});
const loginSchema = zod_1.default.union([emailSchema, usernameSchema]);
router.post("/register", async (req, res) => {
    const result = registrationSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ ok: false, message: "Wrong registration object format" });
    }
    const parsed = result.data;
    const passwordHash = await (0, bcrypt_1.hash)(parsed.password, 10);
    const user = await db_1.prisma.user.create({
        data: {
            email: parsed.email,
            username: parsed.username,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            middleName: parsed.middleName ?? null,
            passwordHash: passwordHash,
        }
    });
    res.status(201).json({ ok: true, message: "Sign-up successful" });
});
router.post("/login", async (req, res) => {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ ok: false, message: "Wrong Login Object Format" });
    }
    const data = result.data;
    const user = await db_1.prisma.user.findUnique({
        where: "email" in data
            ? { email: data.email }
            : { username: data.username }
    });
    if (!user) {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
    const ok = await (0, bcrypt_1.compare)(data.password, user.passwordHash);
    if (!ok) {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
    const accessToken = generateAccessToken({ userId: user.id });
    const refreshToken = (0, jsonwebtoken_1.sign)({ userId: user.id }, refreshTokenSecret, { expiresIn: refreshTokenTTL });
    const tokenHash = await (0, bcrypt_1.hash)(refreshToken, 10);
    await db_1.prisma.refreshToken.create({
        data: {
            tokenHash,
            userId: user.id,
        }
    });
    res.cookie("refresh_token", refreshToken, {
        ...cookieBase,
        maxAge: refreshCookieTTL,
        path: "/auth"
    });
    res.cookie("access_token", accessToken, {
        ...cookieBase,
        maxAge: accessCookieTTL,
        path: "/"
    });
    const { id: _, passwordHash: __, ...safeUser } = user;
    res.status(200).json({ ok: true, user: safeUser });
});
router.post("/refresh", async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (!token) {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
    let payload;
    try {
        payload = (0, jsonwebtoken_1.verify)(token, refreshTokenSecret);
    }
    catch {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
    const userId = payload.userId;
    await db_1.prisma.refreshToken.deleteMany({
        where: { userId, createdAt: { lt: new Date(Date.now() - refreshCookieTTL) } }
    });
    const tokens = await db_1.prisma.refreshToken.findMany({
        where: {
            userId
        }
    });
    let match = false;
    for (const t of tokens) {
        if (await (0, bcrypt_1.compare)(token, t.tokenHash)) {
            match = true;
            break;
        }
    }
    if (!match) {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
    const accessToken = generateAccessToken({ userId });
    res.cookie("access_token", accessToken, {
        ...cookieBase,
        maxAge: accessCookieTTL,
        path: "/"
    });
    res.status(200).json({ ok: true, message: "Refresh Successful" });
});
router.post("/logout", authorize_1.authorizeUser, async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (!token) {
        res.clearCookie("refresh_token", { path: "/auth" });
        res.clearCookie("access_token", { path: "/" });
        return res.status(200).json({ ok: true, message: "Logout Successful" });
    }
    const userId = res.locals.userId;
    const tokens = await db_1.prisma.refreshToken.findMany({
        where: {
            userId
        }
    });
    for (const t of tokens) {
        if (await (0, bcrypt_1.compare)(token, t.tokenHash)) {
            await db_1.prisma.refreshToken.delete({
                where: {
                    id: t.id
                }
            });
            break;
        }
    }
    res.clearCookie("refresh_token", { path: "/auth" });
    res.clearCookie("access_token", { path: "/" });
    return res.status(200).json({ ok: true, message: "Logout Successful" });
});
function generateAccessToken(user) {
    return (0, jsonwebtoken_1.sign)(user, accessTokenSecret, { expiresIn: accessTokenTTL });
}
exports.default = router;
