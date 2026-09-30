import { sign, verify } from "jsonwebtoken"
import express, { Request, Response } from "express"
import { compare, hash } from "bcrypt"
import { randomUUID } from "crypto"
import z from "zod"
import { prisma } from "../services/db"
import { authorizeUser } from "../middlewares/authorize"
import { assertNever } from "../services/assertNever"
import { fail, ok } from "../utils/respond"

const router = express.Router()

const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET!
const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET!
const accessTokenTTL = 60 * 15
const accessCookieTTL = 1000 * 60 * 15
const refreshTokenTTL = 60 * 60 * 24 * 7
const refreshCookieTTL = 1000 * 60 * 60 * 24 * 7
const isProd = process.env.NODE_ENV === "production"

const cookieBase = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd? "none" as const : "lax" as const,
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
    const accessToken = generateAccessToken({ userId: user.id })
    const refreshToken = sign({ userId: user.id }, refreshTokenSecret, { expiresIn: refreshTokenTTL })
    const tokenHash = await hash(refreshToken, 10)
    await prisma.refreshToken.create({
        data: {
            tokenHash,
            jti: randomUUID(),
            expiresAt: new Date(Date.now() + refreshCookieTTL),
            userId: user.id,
        }
    })
    res.cookie("refresh_token", refreshToken, {
        ...cookieBase,
        maxAge: refreshCookieTTL,
        path: "/auth"
    })

    res.cookie("access_token", accessToken, {
        ...cookieBase,
        maxAge: accessCookieTTL,
        path: "/"
    })

    const { createdAt: _, passwordHash: __, updatedAt: ___, ...safeUser } = user
    return ok(res, { user: safeUser })
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

function generateAccessToken(user: { userId: string }) {
    return sign(user, accessTokenSecret, { expiresIn: accessTokenTTL })
}
export default router