import { Router, Request, Response } from "express";
import { prisma } from "../services/db";

const router = Router();

/**
 * GET /health — liveness for orchestrators (Railway healthcheck).
 * 200 when the process and database answer, 503 otherwise. No auth.
 */
router.get("", async (_req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ ok: true });
    } catch {
        res.status(503).json({ ok: false, code: "UNHEALTHY", message: "Database unreachable" });
    }
});

export default router;
