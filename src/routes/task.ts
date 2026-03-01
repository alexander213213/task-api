import { Router, Request, Response } from "express"
import z from "zod"
import { prisma } from "../services/db"
import { authorizeUser } from "../middlewares/authorize"
import { assertNever } from "../services/assertNever"
import { Prisma, Task } from "../../generated/prisma/client"

const router = Router()

const taskRequestSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    reward: z.number(),
    deadline: z.iso.datetime(),
})

const getTaskParamSchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
    sort_by: z.enum(["newest", "reward_desc", "deadline_soon"])
})
const taskPatchSchema = z.discriminatedUnion("op", [
    z.object({
        op: z.literal("replace"),
        path: z.enum(["/title", "/deadline", "/description", "/reward"]),
        value: z.unknown(),
    }),
    z.object({
        op: z.literal("remove"),
        path: z.literal("/description"),
    }),
]);

const proposalSchema = z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(0).max(2000)
})


router.post("", authorizeUser, async (req: Request, res: Response) => {
    const result = taskRequestSchema.safeParse(req.body)
    if (!result.success) {
        return res.status(400).json({ ok: false, message: "Wrong task object format" })
    }

    const user = await prisma.user.findUnique({
        where: {
            id: res.locals.userId as string
        }
    })

    if (!user) {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" })
    }

    const tx = result.data
    await prisma.task.create({
        data: {
            title: tx.title,
            description: tx.description ?? null,
            reward: new Prisma.Decimal(tx.reward),
            deadline: tx.deadline,
            ownerId: res.locals.userId as string
        }
    })

    res.status(200).json({ ok: true, message: "Task Created Successfully" })
})

router.get("", authorizeUser, async (req: Request, res: Response) => {
    const parseResult = getTaskParamSchema.safeParse(req.query)

    if (!parseResult.success) {
        return res.status(400).json({ ok: false, message: "Invalid Query Parameters" })
    }

    const query = parseResult.data

    const limit = Math.min(100, Math.max(1, query.limit ?? 20))

    let orderBy: Prisma.TaskOrderByWithRelationInput[] = []

    switch (query.sort_by) {
        case "newest":
            orderBy = [
                { createdAt: "desc" },
                { id: "desc" }
            ]
            break
        case "reward_desc":
            orderBy = [
                { reward: "desc" },
                { id: "desc" }
            ]
            break
        case "deadline_soon":
            orderBy = [
                { deadline: "asc" },
                { id: "asc" }
            ]
            break
        default:
            assertNever(query.sort_by)
    }

    const tasks = await prisma.task.findMany({
        where: {
            status: "OPEN"
        },
        take: limit + 1,
        ...(query.cursor
            ? { cursor: { id: query.cursor }, skip: 1 }
            : {}
        ),
        include: {
            owner: {
                select: {
                    username: true
                }
            }
        },
        orderBy
    })
    if (!tasks) {
        return res.status(204).json({ ok: true, tasks: [] })
    }

    const hasNextPage = tasks.length > limit
    const page = hasNextPage ? tasks.slice(0, limit) : tasks
    const nextCursor = hasNextPage ? page[page.length - 1]!.id : null


    const tasksBasicInfo = page.map(({ taskerId, updatedAt, ...safeTask }) => safeTask)
    return res.status(200).json({
        ok: true,
        tasks: tasksBasicInfo,
        nextCursor,
        hasNextPage
    })
})

router.get("/me", authorizeUser, async (req: Request, res: Response) => {
    const tasks = await prisma.task.findMany({
        where: {
            ownerId: res.locals.userId as string
        },
    })

    return res.status(200).json({ ok: true, tasks })
})

router.get("/:taskId", authorizeUser, async (req: Request, res: Response) => {

    const task = await prisma.task.findUnique({ where: { id: req.params.taskId as string } })

    if (!task) {
        return res.status(404).json({ ok: false, message: "Task Not Found" })
    }

    res.status(200).json({ ok: true, task })

})

router.patch("/:taskId", authorizeUser, async (req: Request, res: Response) => {
    const parsed = taskPatchSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Wrong Patch Body Format" });
    }

    const id = req.params.taskId;
    const userId = res.locals.userId as string;

    const task = await prisma.task.findUnique({ where: { id: res.locals.userId as string } });
    if (!task) return res.status(404).json({ ok: false, message: "Task Not Found" });
    if (task.ownerId !== userId) return res.status(403).json({ ok: false, message: "Update Forbidden" });

    const data: Prisma.TaskUpdateInput = {};

    if (parsed.data.op === "remove") {
        data.description = null;
    } else {
        const { path, value } = parsed.data;

        if (path === "/title") {
            const v = z.string().min(1).max(200).safeParse(value);
            if (!v.success) return res.status(400).json({ ok: false, message: "Invalid title" });
            data.title = v.data;
        }

        if (path === "/description") {
            const v = z.string().max(2000).nullable().safeParse(value);
            if (!v.success) return res.status(400).json({ ok: false, message: "Invalid description" });
            data.description = v.data;
        }

        if (path === "/deadline") {
            const v = z.iso.datetime().safeParse(value);
            if (!v.success) return res.status(400).json({ ok: false, message: "Invalid deadline" });
            data.deadline = new Date(v.data);
        }

        if (path === "/reward") {
            const v = z.union([z.number(), z.string()]).safeParse(value);
            if (!v.success) return res.status(400).json({ ok: false, message: "Invalid reward" });

            const n = typeof v.data === "string" ? Number(v.data) : v.data;
            if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok: false, message: "Invalid reward" });

            data.reward = new Prisma.Decimal(n);
        }
    }

    const updated = await prisma.task.update({
        where: { id: task.id },
        data,
    });

    return res.status(200).json({ ok: true, task: updated });
});

router.delete("/:taskId", authorizeUser, async (req: Request, res: Response) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.taskId as string } })

    if (!task) return res.status(404).json({ ok: false, message: "Task Not Found" })
    if (task.ownerId !== res.locals.userId) return res.status(403).json({ ok: false, message: "Delete Forbidden" })
    const deletedTask = await prisma.task.delete({ where: { id: task.id } })

    return res.status(200).json({ ok: true, task: deletedTask })
})

router.post("/:taskId/proposals", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string
    const userId = res.locals.userId as string

    const parsed = proposalSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Invalid Request Body" });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: taskId },
                select: { id: true, ownerId: true, status: true },
            });

            if (!task) {
                return { status: 404 as const, body: { ok: false, message: "Task Not Found" } };
            }

            if (task.ownerId === userId) {
                return { status: 403 as const, body: { ok: false, message: "Proposal Forbidden" } };
            }

            // Recommended rule: only allow proposals on OPEN tasks
            if (task.status !== "OPEN") {
                return { status: 409 as const, body: { ok: false, message: "Task is not open for proposals" } };
            }

            const createdProposal = await tx.proposal.create({
                data: {
                    title: parsed.data.title,
                    body: parsed.data.body,
                    taskId: task.id,
                    userId,
                },
                select: {
                    taskId: true,
                    userId: true,
                    title: true,
                    body: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return { status: 200 as const, body: { ok: true, proposal: createdProposal } };
        });

        return res.status(result.status).json(result.body);
    } catch (e: any) {
        // Duplicate proposal for same task+user (composite PK)
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return res.status(409).json({ ok: false, message: "You already submitted a proposal for this task" });
        }
        console.error(e);
        return res.status(500).json({ ok: false, message: "Server Error" });
    }
})

router.get("/:taskId/proposals", authorizeUser, async (req: Request, res: Response) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.taskId as string } })
    if (!task) return res.status(404).json({ ok: false, message: "Task Not Found" })
    if (task.ownerId !== res.locals.userId) return res.status(403).json({ ok: false, message: "Proposal Forbidden" })

    const proposals = await prisma.proposal.findMany({
        where: {
            taskId: task.id
        },
        include: {
            user: {
                select: {
                    username: true,
                    ratingAvg: true,
                    ratingCount: true
                }
            }
        },
        orderBy: [{ createdAt: "asc" }, { userId: "desc" }]
    })
    return res.status(200).json({ ok: true, proposals })
})

router.post("/:taskId/assign", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const ownerId = res.locals.userId as string;

    const body = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ ok: false, message: "Wrong body format" });
    }

    const taskerId = body.data.userId;

    if (taskerId === ownerId) {
        return res.status(400).json({ ok: false, message: "Cannot assign to yourself" });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: taskId },
                select: { id: true, ownerId: true, status: true, taskerId: true },
            });

            if (!task) {
                return { status: 404 as const, body: { ok: false, message: "Task Not Found" } };
            }

            if (task.ownerId !== ownerId) {
                return { status: 403 as const, body: { ok: false, message: "Forbidden" } };
            }

            if (task.status !== "OPEN" || task.taskerId) {
                return { status: 409 as const, body: { ok: false, message: "Task is not assignable" } };
            }

            const proposal = await tx.proposal.findUnique({
                where: {
                    taskId_userId: {
                        taskId: task.id,
                        userId: taskerId,
                    },
                },
                select: { userId: true },
            });

            if (!proposal) {
                return { status: 403 as const, body: { ok: false, message: "Assignment Forbidden" } };
            }

            const updatedCount = await tx.task.updateMany({
                where: { id: task.id, status: "OPEN", taskerId: null },
                data: { taskerId, status: "ASSIGNED" },
            });

            if (updatedCount.count === 0) {
                return { status: 409 as const, body: { ok: false, message: "Task already updated" } };
            }

            const updatedTask = await tx.task.findUnique({
                where: { id: task.id },
                select: { id: true, status: true, ownerId: true, taskerId: true, updatedAt: true },
            });

            return {
                status: 200 as const,
                body: { ok: true, message: "Assignment Successful", task: updatedTask },
            };
        });

        return res.status(result.status).json(result.body);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, message: "Server Error" });
    }
})

router.post("/:taskId/submit", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string
    const userId = res.locals.userId as string
    const newTask = await prisma.task.updateMany({
        where: { id: taskId, taskerId: userId, status: "ASSIGNED" },
        data: { status: "SUBMITTED" }
    })
    if (newTask.count === 0) {
        const exists = await prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true },
        })

        if (!exists) {
            return res.status(404).json({ ok: false, message: "Task Not Found" })
        }

        return res.status(403).json({ ok: false, message: "Forbidden" })
    }
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
            id: true,
            status: true,
            taskerId: true,
            updatedAt: true
        }
    })
    if (!task) return res.status(404).json({ ok: false, message: "Task Not Found" })
    return res.status(200).json({ ok: true, message: "Submission Successful", task })
})

router.post("/:taskId/confirm", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string
    const userId = res.locals.userId as string
    const newTask = await prisma.task.updateMany({
        where: { id: taskId, ownerId: userId, status: "ASSIGNED" },
        data: { status: "SUBMITTED" }
    })
    if (newTask.count === 0) {
        const exists = await prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true },
        })

        if (!exists) {
            return res.status(404).json({ ok: false, message: "Task Not Found" })
        }

        return res.status(403).json({ ok: false, message: "Forbidden" })
    }
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
            id: true,
            status: true,
            taskerId: true,
            updatedAt: true
        }
    })
    if (!task) return res.status(404).json({ ok: false, message: "Task Not Found" })
    return res.status(200).json({ ok: true, message: "Submission Successful", task })
})

router.post("/:taskId/review", authorizeUser, async (req: Request, res: Response) => {
    const body = z.object({
        stars: z.number().int().min(1).max(5),
        comment: z.string().min(1).max(1000),
    }).safeParse(req.body);

    if (!body.success) {
        return res.status(400).json({ ok: false, message: "Wrong Body Format" });
    }

    const userId = res.locals.userId as string;
    const taskId = req.params.taskId as string;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: taskId },
                select: {
                    id: true,
                    ownerId: true,
                    status: true,
                    taskerId: true,
                },
            });

            if (!task) {
                return { status: 404 as const, body: { ok: false, message: "Task Not Found" } };
            }

            if (
                task.ownerId !== userId ||
                task.status !== "COMPLETED" ||
                !task.taskerId
            ) {
                return { status: 403 as const, body: { ok: false, message: "Forbidden" } };
            }

            await tx.review.create({
                data: {
                    taskId: task.id,
                    reviewerId: task.ownerId,
                    revieweeId: task.taskerId,
                    stars: body.data.stars,
                    comment: body.data.comment,
                },
            });

            const tasker = await tx.user.findUnique({
                where: { id: task.taskerId },
                select: { id: true, ratingAvg: true, ratingCount: true },
            });

            if (!tasker) {
                throw new Error("Tasker not found");
            }

            const newCount = tasker.ratingCount + 1;
            const newAvg =
                (tasker.ratingAvg * tasker.ratingCount + body.data.stars) / newCount;

            const updatedTasker = await tx.user.update({
                where: { id: tasker.id },
                data: { ratingAvg: newAvg, ratingCount: newCount },
                select: { id: true, username: true, ratingAvg: true, ratingCount: true },
            });

            return { status: 200 as const, body: { ok: true, tasker: updatedTasker } };
        });

        return res.status(result.status).json(result.body);
    } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return res.status(409).json({ ok: false, message: "Review already exists" });
        }
        console.error(e);
        return res.status(500).json({ ok: false, message: "Server Error" });
    }
})

function isNumber(value: string): boolean {
    if (value.trim() === "") return false
    return !Number.isNaN(Number(value.trim()))
}
export default router