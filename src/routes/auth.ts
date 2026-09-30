import { verify } from "jsonwebtoken"
import express, { Request, Response } from "express"
import { compare, hash } from "bcrypt"
import z from "zod"
import { prisma } from "../services/db"
import { authorizeUser } from "../middlewares/authorize"
import { assertNever } from "../services/assertNever"
import { fail, ok } from "../utils/respond"
import {
    accessCookieTTL,
    cookieBase,
    generateAccessToken,
    issueSession,
    refreshCookieTTL,
    refreshTokenSecret,
} from "../services/session"
import {
    GoogleNotConfiguredError,
    isEmailDomainAllowed,
    verifyGoogleToken,
} from "../services/google"
import type { User } from "../../generated/prisma/client"

const router = express.Router()

function toSafeUser(user: User) {
    const { createdAt: _, passwordHash: __, updatedAt: ___, ...safeUser } = user
    return safeUser
}

const registrationSchema = z.object({
    username: z.string(),
    email: z.email().toLowerCase(),
    firstName: z.string().toLowerCase(),
    lastName: z.string().toLowerCase(),
    middleName: z.string().toLowerCase().optional(),
    password: z.string().min(8)

})



const emailSchema = z.object({
    email: z.email().toLowerCase(),
    password: z.string()
})

const usernameSchema = z.object({
    username: z.string(),
    password: z.string()
})

const loginSchema = z.union([emailSchema, usernameSchema])


router.post("/register", async (req: Request, res: Response) => {
    const result = registrationSchema.safeParse(req.body)
    if (!result.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Wrong registration object format", result.error.issues)
    }

    const parsed = result.data

    const passwordHash = await hash(parsed.password, 10)

    const user = await prisma.user.create({
        data: {
            email: parsed.email,
            username: parsed.username,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            middleName: parsed.middleName ?? null,
            passwordHash: passwordHash,
        }
    })
    return ok(res, null, "Sign-up successful", 201)
})

router.post("/login", async (req: Request, res: Response) => {
    const result = loginSchema.safeParse(req.body)

    if (!result.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Wrong Login Object Format", result.error.issues)
    }

    const data = result.data

    const user = await prisma.user.findUnique({
        where: "email" in data
            ? { email: data.email }
            : { username: data.username }
    })

    if (!user || !user.passwordHash) {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }

    const passwordOk = await compare(data.password, user.passwordHash)

    if (!passwordOk) {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }
    await issueSession(req, res, user.id)

    return ok(res, { user: toSafeUser(user) })
})

router.post("/refresh", async (req: Request, res: Response) => {

    const token: string | undefined = req.cookies?.refresh_token
    if (!token) {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }

    let payload: { userId: string }

    try {
        payload = verify(token, refreshTokenSecret) as { userId: string }
    } catch {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }


    const userId = payload.userId

    await prisma.refreshToken.deleteMany({
        where: { userId, createdAt: { lt: new Date(Date.now() - refreshCookieTTL) } }
    })

    const tokens = await prisma.refreshToken.findMany({
        where: {
            userId
        }
    })

    let match = false
    for (const t of tokens) {
        if (await compare(token, t.tokenHash)) {
            match = true
            break
        }
    }

    if (!match) {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }

    const accessToken = generateAccessToken({ userId })
    res.cookie("access_token", accessToken, {
        ...cookieBase,
        maxAge: accessCookieTTL,
        path: "/"
    })

    return ok(res, null, "Refresh Successful")
})

router.get("/me", authorizeUser, async (req: Request, res: Response) => {
  const userId: string = res.locals.userId as string

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      middleName: true,
      ratingAvg: true,
      ratingCount: true
    }
  })

  if (!user) {
    return fail(res, 404, "NOT_FOUND", "User not found")
  }

  return ok(res, { user })
})

router.post("/logout", authorizeUser, async (req: Request, res: Response) => {
    const token: string | undefined = req.cookies?.refresh_token
    if (!token) {
        res.clearCookie("refresh_token", {path: "/auth"})
        res.clearCookie("access_token", {path: "/"})
        return ok(res, null, "Logout Successful")
    }
    
    const userId = res.locals.userId as string
    
    const tokens = await prisma.refreshToken.findMany({
        where: {
            userId
        }
    })
    
    for (const t of tokens) {
        if (await compare(token, t.tokenHash)) {
            await prisma.refreshToken.delete({
                where: {
                    id: t.id
                }
            })
            break
        }
    }
    
    
    res.clearCookie("refresh_token", {path: "/auth"})
    res.clearCookie("access_token", {path: "/"})

    return ok(res, null, "Logout Successful")
})

router.get("/exist", async (req: Request, res: Response) => {
    const queryRes = z.union([
        z.object({email: z.email()}),
        z.object({username: z.string().min(3)})
    ]).safeParse(req.query)

    if (!queryRes.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Bad Query", queryRes.error.issues)
    }

    let user: {id: string} | null

    const { data } = queryRes
    if ("email" in data) {
        user = await prisma.user.findUnique({
            where: {email: data.email},
            select: {id: true}
        })
    } else {
        user = await prisma.user.findUnique({
            where: {username: data.username},
            select: {id: true}
        })
    }

    if (!user) {
        return ok(res, { exists: false })
    }
    return ok(res, { exists: true })
})

const googleTokenSchema = z.object({
    idToken: z.string().min(1),
})

const googleLinkSchema = z.object({
    idToken: z.string().min(1),
    password: z.string().min(1),
})

async function ensureUniqueUsername(base: string): Promise<string> {
    const slug = base
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 12) || "user"
    for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = attempt === 0 ? `${slug}${Math.floor(Math.random() * 10000)}` : `${slug}${Math.floor(Math.random() * 1000000)}`
        const taken = await prisma.user.findUnique({
            where: { username: candidate },
            select: { id: true },
        })
        if (!taken) return candidate
    }
    return `${slug}${Date.now().toString(36)}`
}

router.post("/google", async (req: Request, res: Response) => {
    const parsed = googleTokenSchema.safeParse(req.body)
    if (!parsed.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Wrong Google Object Format", parsed.error.issues)
    }

    let profile
    try {
        profile = await verifyGoogleToken(parsed.data.idToken)
    } catch (e) {
        if (e instanceof GoogleNotConfiguredError) {
            return fail(res, 500, "SERVER_ERROR", "Google login not configured")
        }
        return fail(res, 401, "UNAUTHORIZED", "Invalid Google token")
    }

    if (!profile.emailVerified) {
        return fail(res, 403, "FORBIDDEN", "Google email not verified")
    }
    if (!isEmailDomainAllowed(profile.email)) {
        return fail(res, 403, "FORBIDDEN", "Email domain not allowed")
    }

    const linked = await prisma.user.findUnique({ where: { googleId: profile.sub } })
    if (linked) {
        await issueSession(req, res, linked.id)
        return ok(res, { user: toSafeUser(linked) })
    }

    const existing = await prisma.user.findUnique({ where: { email: profile.email } })
    if (existing) {
        // Never auto-link: the requester must prove password ownership first.
        return fail(res, 409, "GOOGLE_LINK_REQUIRED", "This email already has an account. Sign in with your password to link Google.")
    }

    const username = await ensureUniqueUsername(profile.email.split("@")[0] ?? "user")
    const user = await prisma.user.create({
        data: {
            email: profile.email,
            username,
            firstName: profile.givenName ?? username,
            lastName: profile.familyName ?? "",
            passwordHash: null,
            googleId: profile.sub,
            provider: "GOOGLE",
            emailVerifiedAt: new Date(),
        },
    })
    await issueSession(req, res, user.id)
    return ok(res, { user: toSafeUser(user) }, undefined, 201)
})

router.post("/google/link", async (req: Request, res: Response) => {
    const parsed = googleLinkSchema.safeParse(req.body)
    if (!parsed.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Wrong Google Link Object Format", parsed.error.issues)
    }

    let profile
    try {
        profile = await verifyGoogleToken(parsed.data.idToken)
    } catch (e) {
        if (e instanceof GoogleNotConfiguredError) {
            return fail(res, 500, "SERVER_ERROR", "Google login not configured")
        }
        return fail(res, 401, "UNAUTHORIZED", "Invalid Google token")
    }

    if (!profile.emailVerified) {
        return fail(res, 403, "FORBIDDEN", "Google email not verified")
    }
    if (!isEmailDomainAllowed(profile.email)) {
        return fail(res, 403, "FORBIDDEN", "Email domain not allowed")
    }

    // Same message whether the account is missing or the password is wrong.
    const user = await prisma.user.findUnique({ where: { email: profile.email } })
    if (!user?.passwordHash) {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }
    if (!(await compare(parsed.data.password, user.passwordHash))) {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }

    if (user.googleId && user.googleId !== profile.sub) {
        return fail(res, 409, "CONFLICT_STATE", "This account is already linked to a different Google account")
    }

    const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
            googleId: profile.sub,
            provider: user.provider === "GOOGLE" ? "GOOGLE" : "BOTH",
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
    })
    await issueSession(req, res, updated.id)
    return ok(res, { user: toSafeUser(updated) })
})

export default router