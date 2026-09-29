import { Router, Request, Response } from "express"
import z from "zod"
import { prisma } from "../services/db"
import { authorizeUser } from "../middlewares/authorize"
import { assertNever } from "../services/assertNever"
import { fail, ok } from "../utils/respond"
import { clampLimit, paginate } from "../utils/paging"
import { decodeCursor, encodeCursor, keysetWhere, sortValueFor } from "../utils/cursor"
import { Prisma, Task } from "../../generated/prisma/client"

const router = Router()

const taskRequestSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    reward: z.number(),
    deadline: z.coerce.date().min(new Date()),
})

const getTaskParamSchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
    sort_by: z.enum(["newest", "reward_desc", "deadline_soon"]).default("newest")
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
        return fail(res, 400, "VALIDATION_ERROR", "Wrong task object format", result.error.issues)
    }

    const user = await prisma.user.findUnique({
        where: {
            id: res.locals.userId as string
        }
    })

    if (!user) {
        return fail(res, 401, "UNAUTHORIZED", "Invalid Credentials")
    }

    const tx = result.data
    const created = await prisma.task.create({
        data: {
            title: tx.title,
            description: tx.description ?? null,
            reward: new Prisma.Decimal(tx.reward),
            deadline: tx.deadline,
            ownerId: res.locals.userId as string
        }
    })

    return ok(res, { task: created }, "Task Created Successfully", 201)
})

router.get("", authorizeUser, async (req: Request, res: Response) => {
    const parseResult = getTaskParamSchema.safeParse(req.query)

    if (!parseResult.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Invalid Query Parameters", parseResult.error.issues)
    }

    const query = parseResult.data

    const limit = clampLimit(query.limit)

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

    const baseWhere: Prisma.TaskWhereInput = {
        status: "OPEN",
        deadline: { gt: new Date() },
        NOT: {
            ownerId: res.locals.userId as string
        }
    }

    let keyset: Prisma.TaskWhereInput | undefined
    if (query.cursor !== undefined) {
        const decoded = decodeCursor(query.cursor)
        if (!decoded || decoded.sort_by !== query.sort_by) {
            return fail(res, 400, "VALIDATION_ERROR", "Invalid cursor")
        }
        try {
            keyset = keysetWhere(decoded)
        } catch {
            return fail(res, 400, "VALIDATION_ERROR", "Invalid cursor")
        }
    }

    const tasks = await prisma.task.findMany({
        where: keyset ? { AND: [baseWhere, keyset] } : baseWhere,
        take: limit + 1,
        include: {
            owner: {
                select: {
                    username: true
                }
            },
            tasker: {
                select: {
                    username: true
                }
            }
        },
        orderBy
    })

    const { page, nextCursor, hasNextPage } = paginate(tasks, limit, (last) =>
        encodeCursor(query.sort_by, sortValueFor(query.sort_by, last), last.id)
    )


    const tasksBasicInfo = page.map(({ taskerId, updatedAt, ...safeTask }) => safeTask)
    return ok(res, {
        tasks: tasksBasicInfo,
        nextCursor,
        hasNextPage
    })
})

const myTasksQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
    status: z.enum(["OPEN", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCELLED"]).optional(),
})

/** Shared newest-first keyset pagination for per-user task lists. */
async function paginateUserTasks(
    res: Response,
    where: Prisma.TaskWhereInput,
    include: Prisma.TaskInclude,
    cursor: string | undefined,
    limit: number,
) {
    let keyset: Prisma.TaskWhereInput | undefined
    if (cursor !== undefined) {
        const decoded = decodeCursor(cursor)
        if (!decoded || decoded.sort_by !== "newest") {
            return fail(res, 400, "VALIDATION_ERROR", "Invalid cursor")
        }
        try {
            keyset = keysetWhere(decoded)
        } catch {
            return fail(res, 400, "VALIDATION_ERROR", "Invalid cursor")
        }
    }

    const tasks = await prisma.task.findMany({
        where: keyset ? { AND: [where, keyset] } : where,
        take: limit + 1,
        include,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    })

    const { page, nextCursor, hasNextPage } = paginate(tasks, limit, (last) =>
        encodeCursor("newest", sortValueFor("newest", last), last.id)
    )

    return ok(res, {
        tasks: page.map(({ taskerId, ...safeTask }) => safeTask),
        nextCursor,
        hasNextPage,
    })
}

router.get("/me", authorizeUser, async (req: Request, res: Response) => {
    const parsed = myTasksQuerySchema.safeParse(req.query)
    if (!parsed.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Invalid Query Parameters", parsed.error.issues)
    }

    const where: Prisma.TaskWhereInput = { ownerId: res.locals.userId as string }
    if (parsed.data.status !== undefined) where.status = parsed.data.status

    return paginateUserTasks(res, where, {
        tasker: { select: { username: true } },
        _count: { select: { proposals: true } },
    }, parsed.data.cursor, clampLimit(parsed.data.limit))
})

router.get("/assigned/me", authorizeUser, async (req: Request, res: Response) => {
    const parsed = myTasksQuerySchema.safeParse(req.query)
    if (!parsed.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Invalid Query Parameters", parsed.error.issues)
    }

    const where: Prisma.TaskWhereInput = { taskerId: res.locals.userId as string }
    if (parsed.data.status !== undefined) where.status = parsed.data.status

    return paginateUserTasks(res, where, {
        owner: { select: { username: true } },
    }, parsed.data.cursor, clampLimit(parsed.data.limit))
})

router.get("/:taskId", authorizeUser, async (req: Request, res: Response) => {
    const viewerId = res.locals.userId as string

    const task = await prisma.task.findUnique({
        where: { id: req.params.taskId as string },
        include: {
            owner: { select: { username: true, ratingAvg: true, ratingCount: true } },
            tasker: { select: { username: true, ratingAvg: true, ratingCount: true } },
            review: { select: { stars: true, comment: true, createdAt: true } },
            _count: { select: { proposals: true } },
        },
    })

    if (!task) {
        return fail(res, 404, "NOT_FOUND", "Task Not Found")
    }

    const myProposal = await prisma.proposal.findUnique({
        where: { taskId_userId: { taskId: task.id, userId: viewerId } },
        select: { title: true, body: true, createdAt: true },
    })

    const { taskerId, ...rest } = task
    return ok(res, { task: { ...rest, myProposal } })

})

router.patch("/:taskId", authorizeUser, async (req: Request, res: Response) => {
    const parsed = taskPatchSchema.safeParse(req.body);
    if (!parsed.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Wrong Patch Body Format", parsed.error.issues);
    }

    const id = req.params.taskId as string;
    const userId = res.locals.userId as string;

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return fail(res, 404, "NOT_FOUND", "Task Not Found");
    if (task.ownerId !== userId) return fail(res, 403, "FORBIDDEN", "Update Forbidden");
    if (task.status !== "OPEN") {
        return fail(res, 409, "CONFLICT_STATE", "Only open tasks can be updated");
    }

    const data: Prisma.TaskUpdateInput = {};

    if (parsed.data.op === "remove") {
        data.description = null;
    } else {
        const { path, value } = parsed.data;

        if (path === "/title") {
            const v = z.string().min(1).max(200).safeParse(value);
            if (!v.success) return fail(res, 400, "VALIDATION_ERROR", "Invalid title", v.error.issues);
            data.title = v.data;
        }

        if (path === "/description") {
            const v = z.string().max(2000).nullable().safeParse(value);
            if (!v.success) return fail(res, 400, "VALIDATION_ERROR", "Invalid description", v.error.issues);
            data.description = v.data;
        }

        if (path === "/deadline") {
            const v = z.coerce.date().min(new Date()).safeParse(value);
            if (!v.success) return fail(res, 400, "VALIDATION_ERROR", "Invalid deadline", v.error.issues);
            data.deadline = new Date(v.data);
        }

        if (path === "/reward") {
            const v = z.union([z.number(), z.string()]).safeParse(value);
            if (!v.success) return fail(res, 400, "VALIDATION_ERROR", "Invalid reward", v.error.issues);

            const n = typeof v.data === "string" ? Number(v.data) : v.data;
            if (!Number.isFinite(n) || n <= 0) return fail(res, 400, "VALIDATION_ERROR", "Invalid reward");

            data.reward = new Prisma.Decimal(n);
        }
    }

    // Guarded write: re-checks ownership + OPEN status atomically so a
    // concurrent assign/cancel wins instead of clobbering the transition.
    const updated = await prisma.task.updateManyAndReturn({
        where: { id: task.id, ownerId: userId, status: "OPEN" },
        data,
    });

    const first = updated[0];
    if (!first) {
        return fail(res, 409, "CONFLICT_STATE", "Task is no longer open");
    }

    return ok(res, { task: first });
});

router.delete("/:taskId", authorizeUser, async (req: Request, res: Response) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.taskId as string } })

    if (!task) return fail(res, 404, "NOT_FOUND", "Task Not Found")
    if (task.ownerId !== res.locals.userId) return fail(res, 403, "FORBIDDEN", "Delete Forbidden")
    // Only OPEN/CANCELLED tasks may be hard-deleted: assigned tasks have a
    // tasker + proposals relying on them, and COMPLETED tasks carry reviews
    // (no cascade) — those must go through cancel/unassign instead.
    if (task.status !== "OPEN" && task.status !== "CANCELLED") {
        return fail(res, 409, "CONFLICT_STATE", "Only open or cancelled tasks can be deleted")
    }
    try {
        const deletedTask = await prisma.task.delete({ where: { id: task.id } })
        return ok(res, { task: deletedTask })
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2025" || e.code === "P2003")) {
            return fail(res, 409, "CONFLICT_STATE", "Task is no longer deletable")
        }
        throw e
    }
})

router.post("/:taskId/proposals", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string
    const userId = res.locals.userId as string

    const parsed = proposalSchema.safeParse(req.body);
    if (!parsed.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Invalid Request Body", parsed.error.issues);
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: taskId },
                select: { id: true, ownerId: true, status: true },
            });

            if (!task) {
                return { status: 404 as const, code: "NOT_FOUND" as const, body: { proposal: null }, message: "Task Not Found" };
            }

            if (task.ownerId === userId) {
                return { status: 403 as const, code: "FORBIDDEN" as const, body: { proposal: null }, message: "Proposal Forbidden" };
            }

            // Recommended rule: only allow proposals on OPEN tasks
            if (task.status !== "OPEN") {
                return { status: 409 as const, code: "CONFLICT_STATE" as const, body: { proposal: null }, message: "Task is not open for proposals" };
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

            return { status: 201 as const, code: null as null, data: { proposal: createdProposal }, message: undefined as undefined };
        });

        if (result.status === 201) {
            return ok(res, result.data, undefined, 201);
        }
        return fail(res, result.status, result.code ?? "CONFLICT_STATE", result.message ?? "Request failed");
    } catch (e: any) {
        // Duplicate proposal for same task+user (composite PK)
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return fail(res, 409, "ALREADY_EXISTS", "You already submitted a proposal for this task");
        }
        console.error(e);
        return fail(res, 500, "SERVER_ERROR", "Server Error");
    }
})

router.get("/:taskId/proposals", authorizeUser, async (req: Request, res: Response) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.taskId as string } })
    if (!task) return fail(res, 404, "NOT_FOUND", "Task Not Found")
    if (task.ownerId !== res.locals.userId) return fail(res, 403, "FORBIDDEN", "Proposal Forbidden")

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
    return ok(res, { proposals })
})

router.post("/:taskId/assign", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const ownerId = res.locals.userId as string;

    const body = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Wrong body format", body.error.issues);
    }

    const taskerId = body.data.userId;

    if (taskerId === ownerId) {
        return fail(res, 400, "VALIDATION_ERROR", "Cannot assign to yourself");
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: taskId },
                select: { id: true, ownerId: true, status: true, taskerId: true },
            });

            if (!task) {
                return { status: 404 as const, code: "NOT_FOUND" as const, message: "Task Not Found", data: null as null };
            }

            if (task.ownerId !== ownerId) {
                return { status: 403 as const, code: "FORBIDDEN" as const, message: "Forbidden", data: null as null };
            }

            if (task.status !== "OPEN" || task.taskerId) {
                return { status: 409 as const, code: "CONFLICT_STATE" as const, message: "Task is not assignable", data: null as null };
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
                return { status: 403 as const, code: "FORBIDDEN" as const, message: "Assignment Forbidden", data: null as null };
            }

            const updatedCount = await tx.task.updateMany({
                where: { id: task.id, status: "OPEN", taskerId: null },
                data: { taskerId, status: "ASSIGNED" },
            });

            if (updatedCount.count === 0) {
                return { status: 409 as const, code: "CONFLICT_STATE" as const, message: "Task already updated", data: null as null };
            }

            const updatedTask = await tx.task.findUnique({
                where: { id: task.id },
                select: { id: true, status: true, ownerId: true, taskerId: true, updatedAt: true },
            });

            return {
                status: 200 as const,
                code: null as null,
                message: "Assignment Successful" as const,
                data: { task: updatedTask },
            };
        });

        if (result.status === 200) {
            return ok(res, result.data, result.message);
        }
        return fail(res, result.status, result.code ?? "CONFLICT_STATE", result.message ?? "Request failed");
    } catch (e) {
        console.error(e);
        return fail(res, 500, "SERVER_ERROR", "Server Error");
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
            select: { id: true, taskerId: true, status: true },
        })

        if (!exists) {
            return fail(res, 404, "NOT_FOUND", "Task Not Found")
        }

        if (exists.taskerId !== userId) {
            return fail(res, 403, "FORBIDDEN", "Forbidden")
        }

        return fail(res, 409, "CONFLICT_STATE", `Task must be ASSIGNED to submit (current: ${exists.status})`)
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
    if (!task) return fail(res, 404, "NOT_FOUND", "Task Not Found")
    return ok(res, { task }, "Submission Successful")
})

router.post("/:taskId/confirm", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string
    const userId = res.locals.userId as string
    const newTask = await prisma.task.updateMany({
        where: { id: taskId, ownerId: userId, status: "SUBMITTED" },
        data: { status: "COMPLETED" }
    })
    if (newTask.count === 0) {
        const exists = await prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true, ownerId: true, status: true },
        })

        if (!exists) {
            return fail(res, 404, "NOT_FOUND", "Task Not Found")
        }

        if (exists.ownerId !== userId) {
            return fail(res, 403, "FORBIDDEN", "Forbidden")
        }

        return fail(res, 409, "CONFLICT_STATE", `Task must be SUBMITTED to confirm (current: ${exists.status})`)
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
    if (!task) return fail(res, 404, "NOT_FOUND", "Task Not Found")
    return ok(res, { task }, "Confirmation Successful")
})

router.post("/:taskId/review", authorizeUser, async (req: Request, res: Response) => {
    const body = z.object({
        stars: z.number().int().min(1).max(5),
        comment: z.string().min(1).max(1000),
    }).safeParse(req.body);

    if (!body.success) {
        return fail(res, 400, "VALIDATION_ERROR", "Wrong Body Format", body.error.issues);
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
                return { status: 404 as const, code: "NOT_FOUND" as const, message: "Task Not Found", data: null as null };
            }

            if (
                task.ownerId !== userId ||
                task.status !== "COMPLETED" ||
                !task.taskerId
            ) {
                return { status: 403 as const, code: "FORBIDDEN" as const, message: "Forbidden", data: null as null };
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

            return { status: 201 as const, code: null as null, message: undefined as undefined, data: { tasker: updatedTasker } };
        });

        if (result.status === 201) {
            return ok(res, result.data, undefined, 201);
        }
        return fail(res, result.status, result.code ?? "FORBIDDEN", result.message ?? "Request failed");
    } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return fail(res, 409, "ALREADY_EXISTS", "Review already exists");
        }
        console.error(e);
        return fail(res, 500, "SERVER_ERROR", "Server Error");
    }
})

router.post("/:taskId/cancel", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string
    const userId = res.locals.userId as string

    const tasks = await prisma.task.updateManyAndReturn({
        where: {id: taskId, ownerId: userId, status: "OPEN"},
        data: {status: "CANCELLED"}
    })
    if (tasks.length === 0) {
        const task = await prisma.task.findUnique({
            where: {id: taskId},
            select: {ownerId: true, status: true}
        })
        if (!task) {
            return fail(res, 404, "NOT_FOUND", "Task Not Found")
        }
        if (task.ownerId !== userId) {
            return fail(res, 403, "FORBIDDEN", "Forbidden")
        }
        
        if (task.status !== "OPEN") {
            return fail(res, 409, "CONFLICT_STATE", "Task Is Not Open")
        }
        return fail(res, 409, "CONFLICT_STATE", "Task could not be cancelled");
    }

    return ok(res, { task: tasks[0] }, "Task Cancelled Successfully")
})

router.post("/:taskId/unassign", authorizeUser, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string
    const userId = res.locals.userId as string

    const tasks = await prisma.task.updateManyAndReturn({
        where: {
            id: taskId,
            ownerId: userId,
            OR: [
                {status: "ASSIGNED"},
                {status: "SUBMITTED"}
            ]
        },
        data: {status: "OPEN", taskerId: null}
    })
    if (tasks.length === 0) {
        const task = await prisma.task.findUnique({
            where: {id: taskId},
            select: {ownerId: true, status: true}
        })
        if (!task) {
            return fail(res, 404, "NOT_FOUND", "Task Not Found")
        }
        if (task.ownerId !== userId) {
            return fail(res, 403, "FORBIDDEN", "Forbidden")
        }
        
        if (task.status !== "ASSIGNED" && task.status !== "SUBMITTED" ) {
            return fail(res, 409, "CONFLICT_STATE", "Task is not assigned or submitten")
        }
        return fail(res, 409, "CONFLICT_STATE", "Task could not be unassigned");
    }
    return ok(res, { task: tasks[0] }, "Task Unassigned Successfully")
})

export default router