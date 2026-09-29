import { NextFunction, Request, Response, } from "express"
import { PrismaClientKnownRequestError } from "../../generated/prisma/internal/prismaNamespace"
import { fail } from "../utils/respond"

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
    // console.error(err)
    if (err instanceof PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
            const fields = err.meta?.target as string[] | undefined

            if (fields?.includes("email")) {
                return fail(res, 409, "ALREADY_EXISTS", "Email already exists")
            }

            if (fields?.includes("username")) {
                return fail(res, 409, "ALREADY_EXISTS", "Username already exists")
            }

            return fail(res, 409, "ALREADY_EXISTS", "Unique constraint failed")
        }
    }

    return fail(res, 500, "SERVER_ERROR", "Internal server error")
}