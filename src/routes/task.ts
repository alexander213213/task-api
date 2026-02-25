import { Router, Request, Response } from "express"
import z from "zod"
import { prisma } from "../services/db"
import { authorizeUser } from "../middlewares/authorize"

const router = Router()

const taskRequestSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    reward: z.number(),
    deadline: z.iso.datetime(),
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