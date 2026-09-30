import rateLimit from "express-rate-limit";

/**
 * Brute-force guard for credential and token endpoints.
 * Skipped entirely under NODE_ENV=test so the suite can hammer login freely.
 */
export const sensitiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    message: { ok: false, code: "RATE_LIMITED", message: "Too many requests, slow down" },
});
