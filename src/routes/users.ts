import { Router, Request, Response } from "express";
import { prisma } from "../services/db";
import { authorizeUser } from "../middlewares/authorize";
import { fail, ok } from "../utils/respond";

const router = Router();

router.get("/me/stats", authorizeUser, async (req: Request, res: Response) => {
    const userId = res.locals.userId as string;

    const [user, posted, active, completedAsTasker, proposalsSent] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, ratingAvg: true, ratingCount: true },
        }),
        prisma.task.count({ where: { ownerId: userId } }),
        prisma.task.count({
            where: { taskerId: userId, status: { in: ["ASSIGNED", "SUBMITTED"] } },
        }),
        prisma.task.count({ where: { taskerId: userId, status: "COMPLETED" } }),
        prisma.proposal.count({ where: { userId } }),
    ]);

    if (!user) return fail(res, 404, "NOT_FOUND", "User not found");

    return ok(res, {
        user,
        posted,
        active,
        completedAsTasker,
        proposalsSent,
    });
});

router.get("/:id/public", authorizeUser, async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
        where: { id: req.params.id as string },
        select: { id: true, username: true, ratingAvg: true, ratingCount: true },
    });

    if (!user) return fail(res, 404, "NOT_FOUND", "User not found");

    const [posted, completedAsTasker] = await Promise.all([
        prisma.task.count({ where: { ownerId: user.id } }),
        prisma.task.count({ where: { taskerId: user.id, status: "COMPLETED" } }),
    ]);

    return ok(res, { user: { ...user, posted, completedAsTasker } });
});

export default router;
