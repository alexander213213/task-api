import { sign, verify } from "jsonwebtoken"
import express, { Request, Response } from "express"
import { compare, hash } from "bcrypt"
import z from "zod"
import { prisma } from "../services/db"
import { authorizeUser } from "../middlewares/authorize"

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
    sameSite: "lax" as const,
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
        return res.status(400).json({ok: false, message: "Wrong registration object format"})
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
    res.status(201).json({ok: true, message: "Sign-up successful"})
})

router.post("/login", async (req: Request, res: Response) => {
    const result = loginSchema.safeParse(req.body)

    if (!result.success) {
        return res.status(400).json({ok: false, message: "Wrong Login Object Format"})
    }

    const data = result.data

    const user = await prisma.user.findUnique({
        where: "email" in data
            ? { email: data.email }
            : { username: data.username }
    })

    if (!user) {
        return res.status(401).json({ok: false, message: "Invalid Credentials"})
    }

    const ok = await compare(data.password, user.passwordHash)

    if (!ok) {
        return res.status(401).json({ok: false, message: "Invalid Credentials"})
    }
    const accessToken = generateAccessToken({ userId: user.id })
    const refreshToken = sign({ userId: user.id }, refreshTokenSecret, { expiresIn: refreshTokenTTL })
    const tokenHash = await hash(refreshToken, 10)
    await prisma.refreshToken.create({
        data: {
            tokenHash,
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

    const { id: _, passwordHash: __, ...safeUser } = user
    res.status(200).json({ ok: true, user: safeUser })
})

router.post("/refresh", async (req: Request, res: Response) => {

    const token: string | undefined = req.cookies?.refresh_token
    if (!token) {
        return res.status(401).json({ok: false, message: "Invalid Credentials"})
    }

    let payload: { userId: string }

    try {
        payload = verify(token, refreshTokenSecret) as { userId: string }
    } catch {
        return res.status(401).json({ok: false, message: "Invalid Credentials"})
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
        return res.status(401).json({ok: false, message: "Invalid Credentials"})
    }

    const accessToken = generateAccessToken({ userId })
    res.cookie("access_token", accessToken, {
        ...cookieBase,
        maxAge: accessCookieTTL,
        path: "/"
    })

    res.status(200).json({ok: true, message: "Refresh Successful"})
})

router.post("/logout", authorizeUser, async (req: Request, res: Response) => {
    const token: string | undefined = req.cookies?.refresh_token
    if (!token) {
        res.clearCookie("refresh_token", {path: "/auth"})
        res.clearCookie("access_token", {path: "/"})
        return res.status(200).json({ok: true, message: "Logout Successful"})
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

    return res.status(200).json({ok: true, message: "Logout Successful"})
})

function generateAccessToken(user: { userId: string }) {
    return sign(user, accessTokenSecret, { expiresIn: accessTokenTTL })
}
export default router