"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = __importDefault(require("zod"));
const db_1 = require("../services/db");
const authorize_1 = require("../middlewares/authorize");
const assertNever_1 = require("../services/assertNever");
const client_1 = require("../../generated/prisma/client");
const router = (0, express_1.Router)();
const taskRequestSchema = zod_1.default.object({
    title: zod_1.default.string().min(1).max(200),
    description: zod_1.default.string().max(2000).optional(),
    reward: zod_1.default.number(),
    deadline: zod_1.default.coerce.date().min(new Date()),
});
const getTaskParamSchema = zod_1.default.object({
    cursor: zod_1.default.string().optional(),
    limit: zod_1.default.coerce.number().optional(),
    sort_by: zod_1.default.enum(["newest", "reward_desc", "deadline_soon"])
});
const taskPatchSchema = zod_1.default.discriminatedUnion("op", [
    zod_1.default.object({
        op: zod_1.default.literal("replace"),
        path: zod_1.default.enum(["/title", "/deadline", "/description", "/reward"]),
        value: zod_1.default.unknown(),
    }),
    zod_1.default.object({
        op: zod_1.default.literal("remove"),
        path: zod_1.default.literal("/description"),
    }),
]);
const proposalSchema = zod_1.default.object({
    title: zod_1.default.string().min(1).max(200),
    body: zod_1.default.string().min(0).max(2000)
});
router.post("", authorize_1.authorizeUser, async (req, res) => {
    const result = taskRequestSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ ok: false, message: "Wrong task object format" });
    }
    const user = await db_1.prisma.user.findUnique({
        where: {
            id: res.locals.userId
        }
    });
    if (!user) {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
    const tx = result.data;
    await db_1.prisma.task.create({
        data: {
            title: tx.title,
            description: tx.description ?? null,
            reward: new client_1.Prisma.Decimal(tx.reward),
            deadline: tx.deadline,
            ownerId: res.locals.userId
        }
    });
    res.status(200).json({ ok: true, message: "Task Created Successfully" });
});
router.get("", authorize_1.authorizeUser, async (req, res) => {
    const parseResult = getTaskParamSchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ ok: false, message: "Invalid Query Parameters" });
    }
    const query = parseResult.data;
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    let orderBy = [];
    switch (query.sort_by) {
        case "newest":
            orderBy = [
                { createdAt: "desc" },
                { id: "desc" }
            ];
            break;
        case "reward_desc":
            orderBy = [
                { reward: "desc" },
                { id: "desc" }
            ];
            break;
        case "deadline_soon":
            orderBy = [
                { deadline: "asc" },
                { id: "asc" }
            ];
            break;
        default:
            (0, assertNever_1.assertNever)(query.sort_by);
    }
    const tasks = await db_1.prisma.task.findMany({
        where: {
            status: "OPEN",
            deadline: { gt: new Date() }
        },
        take: limit + 1,
        ...(query.cursor
            ? { cursor: { id: query.cursor }, skip: 1 }
            : {}),
        include: {
            owner: {
                select: {
                    username: true
                }
            }
        },
        orderBy
    });
    const hasNextPage = tasks.length > limit;
    const page = hasNextPage ? tasks.slice(0, limit) : tasks;
    const nextCursor = hasNextPage ? page[page.length - 1].id : null;
    const tasksBasicInfo = page.map(({ taskerId, updatedAt, ...safeTask }) => safeTask);
    return res.status(200).json({
        ok: true,
        tasks: tasksBasicInfo,
        nextCursor,
        hasNextPage
    });
});
router.get("/me", authorize_1.authorizeUser, async (req, res) => {
    const tasks = await db_1.prisma.task.findMany({
        where: {
            ownerId: res.locals.userId
        },
    });
    return res.status(200).json({ ok: true, tasks });
});
router.get("/:taskId", authorize_1.authorizeUser, async (req, res) => {
    const task = await db_1.prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!task) {
        return res.status(404).json({ ok: false, message: "Task Not Found" });
    }
    res.status(200).json({ ok: true, task });
});
router.patch("/:taskId", authorize_1.authorizeUser, async (req, res) => {
    const parsed = taskPatchSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Wrong Patch Body Format" });
    }
    const id = req.params.taskId;
    const userId = res.locals.userId;
    const task = await db_1.prisma.task.findUnique({ where: { id } });
    if (!task)
        return res.status(404).json({ ok: false, message: "Task Not Found" });
    if (task.ownerId !== userId)
        return res.status(403).json({ ok: false, message: "Update Forbidden" });
    const data = {};
    if (parsed.data.op === "remove") {
        data.description = null;
    }
    else {
        const { path, value } = parsed.data;
        if (path === "/title") {
            const v = zod_1.default.string().min(1).max(200).safeParse(value);
            if (!v.success)
                return res.status(400).json({ ok: false, message: "Invalid title" });
            data.title = v.data;
        }
        if (path === "/description") {
            const v = zod_1.default.string().max(2000).nullable().safeParse(value);
            if (!v.success)
                return res.status(400).json({ ok: false, message: "Invalid description" });
            data.description = v.data;
        }
        if (path === "/deadline") {
            const v = zod_1.default.coerce.date().min(new Date()).safeParse(value);
            if (!v.success)
                return res.status(400).json({ ok: false, message: "Invalid deadline" });
            data.deadline = new Date(v.data);
        }
        if (path === "/reward") {
            const v = zod_1.default.union([zod_1.default.number(), zod_1.default.string()]).safeParse(value);
            if (!v.success)
                return res.status(400).json({ ok: false, message: "Invalid reward" });
            const n = typeof v.data === "string" ? Number(v.data) : v.data;
            if (!Number.isFinite(n) || n <= 0)
                return res.status(400).json({ ok: false, message: "Invalid reward" });
            data.reward = new client_1.Prisma.Decimal(n);
        }
    }
    const updated = await db_1.prisma.task.update({
        where: { id: task.id },
        data,
    });
    return res.status(200).json({ ok: true, task: updated });
});
router.delete("/:taskId", authorize_1.authorizeUser, async (req, res) => {
    const task = await db_1.prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!task)
        return res.status(404).json({ ok: false, message: "Task Not Found" });
    if (task.ownerId !== res.locals.userId)
        return res.status(403).json({ ok: false, message: "Delete Forbidden" });
    const deletedTask = await db_1.prisma.task.delete({ where: { id: task.id } });
    return res.status(200).json({ ok: true, task: deletedTask });
});
router.post("/:taskId/proposals", authorize_1.authorizeUser, async (req, res) => {
    const taskId = req.params.taskId;
    const userId = res.locals.userId;
    const parsed = proposalSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Invalid Request Body" });
    }
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: taskId },
                select: { id: true, ownerId: true, status: true },
            });
            if (!task) {
                return { status: 404, body: { ok: false, message: "Task Not Found" } };
            }
            if (task.ownerId === userId) {
                return { status: 403, body: { ok: false, message: "Proposal Forbidden" } };
            }
            // Recommended rule: only allow proposals on OPEN tasks
            if (task.status !== "OPEN") {
                return { status: 409, body: { ok: false, message: "Task is not open for proposals" } };
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
            return { status: 200, body: { ok: true, proposal: createdProposal } };
        });
        return res.status(result.status).json(result.body);
    }
    catch (e) {
        // Duplicate proposal for same task+user (composite PK)
        if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return res.status(409).json({ ok: false, message: "You already submitted a proposal for this task" });
        }
        console.error(e);
        return res.status(500).json({ ok: false, message: "Server Error" });
    }
});
router.get("/:taskId/proposals", authorize_1.authorizeUser, async (req, res) => {
    const task = await db_1.prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!task)
        return res.status(404).json({ ok: false, message: "Task Not Found" });
    if (task.ownerId !== res.locals.userId)
        return res.status(403).json({ ok: false, message: "Proposal Forbidden" });
    const proposals = await db_1.prisma.proposal.findMany({
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
    });
    return res.status(200).json({ ok: true, proposals });
});
router.post("/:taskId/assign", authorize_1.authorizeUser, async (req, res) => {
    const taskId = req.params.taskId;
    const ownerId = res.locals.userId;
    const body = zod_1.default.object({ userId: zod_1.default.string().min(1) }).safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ ok: false, message: "Wrong body format" });
    }
    const taskerId = body.data.userId;
    if (taskerId === ownerId) {
        return res.status(400).json({ ok: false, message: "Cannot assign to yourself" });
    }
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: taskId },
                select: { id: true, ownerId: true, status: true, taskerId: true },
            });
            if (!task) {
                return { status: 404, body: { ok: false, message: "Task Not Found" } };
            }
            if (task.ownerId !== ownerId) {
                return { status: 403, body: { ok: false, message: "Forbidden" } };
            }
            if (task.status !== "OPEN" || task.taskerId) {
                return { status: 409, body: { ok: false, message: "Task is not assignable" } };
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
                return { status: 403, body: { ok: false, message: "Assignment Forbidden" } };
            }
            const updatedCount = await tx.task.updateMany({
                where: { id: task.id, status: "OPEN", taskerId: null },
                data: { taskerId, status: "ASSIGNED" },
            });
            if (updatedCount.count === 0) {
                return { status: 409, body: { ok: false, message: "Task already updated" } };
            }
            const updatedTask = await tx.task.findUnique({
                where: { id: task.id },
                select: { id: true, status: true, ownerId: true, taskerId: true, updatedAt: true },
            });
            return {
                status: 200,
                body: { ok: true, message: "Assignment Successful", task: updatedTask },
            };
        });
        return res.status(result.status).json(result.body);
    }
    catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, message: "Server Error" });
    }
});
router.post("/:taskId/submit", authorize_1.authorizeUser, async (req, res) => {
    const taskId = req.params.taskId;
    const userId = res.locals.userId;
    const newTask = await db_1.prisma.task.updateMany({
        where: { id: taskId, taskerId: userId, status: "ASSIGNED" },
        data: { status: "SUBMITTED" }
    });
    if (newTask.count === 0) {
        const exists = await db_1.prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true },
        });
        if (!exists) {
            return res.status(404).json({ ok: false, message: "Task Not Found" });
        }
        return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const task = await db_1.prisma.task.findUnique({
        where: { id: taskId },
        select: {
            id: true,
            status: true,
            taskerId: true,
            updatedAt: true
        }
    });
    if (!task)
        return res.status(404).json({ ok: false, message: "Task Not Found" });
    return res.status(200).json({ ok: true, message: "Submission Successful", task });
});
router.post("/:taskId/confirm", authorize_1.authorizeUser, async (req, res) => {
    const taskId = req.params.taskId;
    const userId = res.locals.userId;
    const newTask = await db_1.prisma.task.updateMany({
        where: { id: taskId, ownerId: userId, status: "SUBMITTED" },
        data: { status: "COMPLETED" }
    });
    if (newTask.count === 0) {
        const exists = await db_1.prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true },
        });
        if (!exists) {
            return res.status(404).json({ ok: false, message: "Task Not Found" });
        }
        return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const task = await db_1.prisma.task.findUnique({
        where: { id: taskId },
        select: {
            id: true,
            status: true,
            taskerId: true,
            updatedAt: true
        }
    });
    if (!task)
        return res.status(404).json({ ok: false, message: "Task Not Found" });
    return res.status(200).json({ ok: true, message: "Confirmation Successful", task });
});
router.post("/:taskId/review", authorize_1.authorizeUser, async (req, res) => {
    const body = zod_1.default.object({
        stars: zod_1.default.number().int().min(1).max(5),
        comment: zod_1.default.string().min(1).max(1000),
    }).safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ ok: false, message: "Wrong Body Format" });
    }
    const userId = res.locals.userId;
    const taskId = req.params.taskId;
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
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
                return { status: 404, body: { ok: false, message: "Task Not Found" } };
            }
            if (task.ownerId !== userId ||
                task.status !== "COMPLETED" ||
                !task.taskerId) {
                return { status: 403, body: { ok: false, message: "Forbidden" } };
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
            const newAvg = (tasker.ratingAvg * tasker.ratingCount + body.data.stars) / newCount;
            const updatedTasker = await tx.user.update({
                where: { id: tasker.id },
                data: { ratingAvg: newAvg, ratingCount: newCount },
                select: { id: true, username: true, ratingAvg: true, ratingCount: true },
            });
            return { status: 200, body: { ok: true, tasker: updatedTasker } };
        });
        return res.status(result.status).json(result.body);
    }
    catch (e) {
        if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return res.status(409).json({ ok: false, message: "Review already exists" });
        }
        console.error(e);
        return res.status(500).json({ ok: false, message: "Server Error" });
    }
});
router.post("/:taskId/cancel", authorize_1.authorizeUser, async (req, res) => {
    const taskId = req.params.taskId;
    const userId = res.locals.userId;
    const tasks = await db_1.prisma.task.updateManyAndReturn({
        where: { id: taskId, ownerId: userId, status: "OPEN" },
        data: { status: "CANCELLED" }
    });
    if (tasks.length === 0) {
        const task = await db_1.prisma.task.findUnique({
            where: { id: taskId },
            select: { ownerId: true, status: true }
        });
        if (!task) {
            return res.status(404).json({ ok: false, message: "Task Not Found" });
        }
        if (task.ownerId !== userId) {
            return res.status(403).json({ ok: false, message: "Forbidden" });
        }
        if (task.status !== "OPEN") {
            return res.status(409).json({ ok: false, message: "Task Is Not Open" });
        }
        return res.status(409).json({ ok: false, message: "Task could not be cancelled" });
    }
    return res.status(200).json({ ok: true, message: "Task Cancelled Successfully", task: tasks[0] });
});
router.post("/:taskId/unassign", authorize_1.authorizeUser, async (req, res) => {
    const taskId = req.params.taskId;
    const userId = res.locals.userId;
    const tasks = await db_1.prisma.task.updateManyAndReturn({
        where: {
            id: taskId,
            ownerId: userId,
            OR: [
                { status: "ASSIGNED" },
                { status: "SUBMITTED" }
            ]
        },
        data: { status: "OPEN", taskerId: null }
    });
    if (tasks.length === 0) {
        const task = await db_1.prisma.task.findUnique({
            where: { id: taskId },
            select: { ownerId: true, status: true }
        });
        if (!task) {
            return res.status(404).json({ ok: false, message: "Task Not Found" });
        }
        if (task.ownerId !== userId) {
            return res.status(403).json({ ok: false, message: "Forbidden" });
        }
        if (task.status !== "ASSIGNED" && task.status !== "SUBMITTED") {
            return res.status(409).json({ ok: false, message: "Task is not assigned or submitten" });
        }
        return res.status(409).json({ ok: false, message: "Task could not be unassigned" });
    }
    return res.status(200).json({ ok: true, message: "Task Unassigned Successfully", task: tasks[0] });
});
function isNumber(value) {
    if (value.trim() === "")
        return false;
    return !Number.isNaN(Number(value.trim()));
}
exports.default = router;
