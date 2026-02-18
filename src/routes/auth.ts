import {sign} from "jsonwebtoken"
import express, {Express, Request, Response} from "express"
import { compare, hash } from "bcrypt"

import type { User } from "../../generated/prisma/client"
import z, { jwt } from "zod"
import { prisma } from "../services/db"

const router = express.Router()



const registrationSchema = z.object({
    username: z.string(),
    email: z.email().toLowerCase(),
    firstName: z.string().toLowerCase(),
    lastName: z.string().toLowerCase(),
    middleName: z.string().toLowerCase().optional(),
    password: z.string().min(8)

})

router.post("/register", async (req: Request, res: Response) => {
    const result = registrationSchema.safeParse(req.body)
    if (!result.success) {
        return res.status(400).send("Wrong request format")
    }

    const parsed = result.data

    const passwordHash = await hash(parsed.password, 10)

    const user = await prisma.user.create({
        data: {
            email: parsed.email,
            username: parsed.username,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            middleName: parsed.middleName ?? null,
            passwordHash: passwordHash,
        }
    })
    const {passwordHash: _,id: __,  ...safeUser} = user
    res.status(201).json(safeUser)
})

export default router