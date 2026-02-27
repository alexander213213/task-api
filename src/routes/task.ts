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
const patchSchema = z.discriminatedUnion("op", [
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

router.get("/:id", authorizeUser, async (req: Request, res: Response) => {

    const task = await prisma.task.findUnique({ where: { id: req.params.id as string } })

    if (!task) {
        return res.status(404).json({ ok: false, message: "Task Not Found" })
    }

    res.status(200).json({ ok: true, task })

})

router.patch("/:id", authorizeUser, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, message: "Wrong Patch Body Format" });
  }

  const id = req.params.id;
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
    where: { id: res.locals.userId as string },
    data,
  });

  return res.status(200).json({ ok: true, task: updated });
});

function isNumber(value: string): boolean {
    if (value.trim() === "") return false
    return !Number.isNaN(Number(value.trim()))
}
export default router