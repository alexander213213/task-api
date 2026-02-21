import { prisma } from "../../src/services/db"

export async function resetDb() {
    await prisma.proposal.deleteMany()
    await prisma.user.deleteMany()
    await prisma.task.deleteMany()
    await prisma.refreshToken.deleteMany()
}