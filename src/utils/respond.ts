import { Response } from "express";

/**
 * Standard API envelope.
 * Success: { ok: true, data, message? }
 * Error:   { ok: false, code, message, issues? }
 */
export type ErrorCode =
    | "VALIDATION_ERROR"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT_STATE"
    | "ALREADY_EXISTS"
    | "GOOGLE_LINK_REQUIRED"
    | "EMAIL_NOT_VERIFIED"
    | "RATE_LIMITED"
    | "SERVER_ERROR";

export function ok<T>(res: Response, data: T, message?: string, status = 200) {
    return message === undefined
        ? res.status(status).json({ ok: true, data })
        : res.status(status).json({ ok: true, data, message });
}

export function fail(res: Response, status: number, code: ErrorCode, message: string, issues?: unknown) {
    return issues === undefined
        ? res.status(status).json({ ok: false, code, message })
        : res.status(status).json({ ok: false, code, message, issues });
}
