import { prisma } from "../../src/services/db"

export async function resetDb() {
    await prisma.refreshToken.deleteMany()
    await prisma.proposal.deleteMany()
    await prisma.task.deleteMany()
    await prisma.user.deleteMany()
}