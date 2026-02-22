import { NextFunction, Request, Response, } from "express"
import { PrismaClientKnownRequestError } from "../../generated/prisma/internal/prismaNamespace"

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
    // console.error(err)
    if (err instanceof PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
            const fields = err.meta?.target as string[] | undefined

            if (fields?.includes("email")) {
                return res.status(409).json({ ok: false, error: "Email already exists" })
            }

            if (fields?.includes("username")) {
                return res.status(409).json({ ok: false, error: "Username already exists" })
            }

            return res.status(409).json({ ok: false, error: "Unique constraint failed" })
        }
    }

    res.status(500).json({ error: "Internal server error" })
}