import { Router, Request, Response } from "express"
import z from "zod"
import { prisma } from "../services/db"
import { authorizeUser } from "../middlewares/authorize"
import { assertNever } from "../services/assertNever"
import { Prisma } from "../../generated/prisma/client"

const router = Router()

const taskRequestSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    reward: z.number(),
    deadline: z.iso.datetime(),
})

const getTaskParamSchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
    sortBy: z.enum(["newest", "reward_desc", "deadline_soon"])
})


router.post("", authorizeUser, async (req: Request, res: Response) => {
    const result = taskRequestSchema.safeParse(req.body)
    if (!result.success) {
        return res.status(400).json({ok: false, message: "Wrong task object format"})
    }
    
    const user = await prisma.user.findUnique({
        where: {
            id: res.locals.userId as string
        }
    })

    if (!user) {
        res.status(401).jsonp({ok: false, message: "Invalid Credentials"})
    }

    const tx = result.data
    await prisma.task.create({
        data: {
            title: tx.title,
            description: tx.description ?? null,
            reward: tx.reward,
            deadline: tx.deadline,
            ownerId: res.locals.userId as string
        }
    })

    res.status(200).json({ok: true, message: "Task Created Successfully"})
})

router.get("", authorizeUser, async (req: Request, res: Response) => {
    const parseResult = getTaskParamSchema.safeParse(req.query)

    if (!parseResult.success) {
        return res.status(400).json({ok: false, message: "Invalid Query Parameters"})
    }

    const query = parseResult.data

    let orderBy: Prisma.TaskOrderByWithRelationInput[] = []

    switch (query.sortBy) {
        case "newest":
            orderBy = [
                {id: "desc"},
                {createdAt: "desc"}
            ]
            break
        case "reward_desc":
            orderBy = [
                {id: "desc"},
                {reward: "desc"}
            ]
            break
        case "deadline_soon":
            orderBy = [
                {id: "asc"},
                {deadline: "asc"}
            ]
            break
        default:
            assertNever(query.sortBy)
    }
    
    const tasks = await prisma.task.findMany({
        where: {
            status: "OPEN"
        },
        take: Math.min(100, Math.max(1, query.limit ?? 20)),
        ...(query.cursor
            ? {cursor: {id: query.cursor}, skip: 1}
            : {}
        ),
        orderBy
    })
    if (!tasks) {
        return res.status(204).json({ok: true, tasks: []})
    }

    const tasksBasicInfo = tasks.map(({taskerId, updatedAt, ...safeTask}) => safeTask)

    return res.status(200).json({ok: true, tasks: tasksBasicInfo})
})

router.get("/:id", authorizeUser, async (req: Request, res: Response) => {

    const task = await prisma.task.findUnique({where: {id: req.params.id as string}})

    if (!task) {
        res.status(404).json({ok: false, message: "Task Not Found"})
    }
    
    res.status(200).json({ok: true, task})
    
})

function isNumber(value: string): boolean {
    if (value.trim() === "") return false
    return !Number.isNaN(Number(value.trim()))
}
export default router