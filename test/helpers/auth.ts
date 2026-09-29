import app from "../../src/server";
import request from "supertest";
import { prisma } from "../../src/services/db";
import { hash } from "bcrypt";

export const TEST_PASSWORD = "Password123!";

export async function createUser(username: string, email: string) {
    return prisma.user.create({
        data: {
            username,
            email,
            firstName: "Test",
            lastName: "User",
            passwordHash: await hash(TEST_PASSWORD, 4),
        },
    });
}

export async function loginCookies(identifier: { email: string }) {
    const res = await request(app).post("/auth/login").send({ ...identifier, password: TEST_PASSWORD });
    if (res.status !== 200) {
        throw new Error(`Login failed for ${identifier.email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return (res.headers["set-cookie"] ?? []) as string[];
}
