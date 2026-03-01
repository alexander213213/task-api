"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const prismaNamespace_1 = require("../../generated/prisma/internal/prismaNamespace");
function errorHandler(err, req, res, next) {
    // console.error(err)
    if (err instanceof prismaNamespace_1.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
            const fields = err.meta?.target;
            if (fields?.includes("email")) {
                return res.status(409).json({ ok: false, error: "Email already exists" });
            }
            if (fields?.includes("username")) {
                return res.status(409).json({ ok: false, error: "Username already exists" });
            }
            return res.status(409).json({ ok: false, error: "Unique constraint failed" });
        }
    }
    res.status(500).json({ error: "Internal server error" });
}
