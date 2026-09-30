import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { prisma } from "../../src/services/db";
import { hash } from "bcrypt";
import { getCookie } from "../helpers/getCookie";

const PASSWORD = "myPassword";

async function createUser(username: string, email: string) {
    return prisma.user.create({
        data: {
            email,
            username,
            firstName: "Test",
            lastName: "User",
            passwordHash: await hash(PASSWORD, 4),
        },
    });
}

async function loginRaw(email: string) {
    return request(app).post("/auth/login").send({ email, password: PASSWORD });
}

function cookiesOf(res: request.Response): string[] {
    return (res.headers["set-cookie"] ?? []) as string[];
}

describe("refresh rotation", () => {
    beforeEach(async () => {
        await resetDb();
    });

    it("rotates the refresh token and rejects the old one", async () => {
        const user = await createUser("rot1", "rot1@test.com");
        const first = await loginRaw(user.email);
        expect(first.status).toBe(200);
        const cookies1 = cookiesOf(first);

        const second = await request(app).post("/auth/refresh").set("Cookie", cookies1);
        expect(second.status).toBe(200);
        const cookies2 = cookiesOf(second);
        expect(getCookie(cookies2, "refresh_token")).toBeTruthy();
        expect(getCookie(cookies2, "refresh_token")).not.toBe(getCookie(cookies1, "refresh_token"));

        // Old token was rotated: reuse is rejected...
        const reuse = await request(app).post("/auth/refresh").set("Cookie", cookies1);
        expect(reuse.status).toBe(401);

        // ...and the reuse nuked every session, including the rotated one.
        const rotated = await request(app).post("/auth/refresh").set("Cookie", cookies2);
        expect(rotated.status).toBe(401);

        // A fresh login works again.
        const fresh = await loginRaw(user.email);
        expect(fresh.status).toBe(200);
    });

    it("rejects expired refresh tokens with 401", async () => {
        const user = await createUser("rot2", "rot2@test.com");
        const first = await loginRaw(user.email);
        const cookies = cookiesOf(first);

        await prisma.refreshToken.updateMany({
            where: { userId: user.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const res = await request(app).post("/auth/refresh").set("Cookie", cookies);
        expect(res.status).toBe(401);
    });

    it("logout-all kills every session", async () => {
        const user = await createUser("rot3", "rot3@test.com");
        const agentA = request.agent(app);
        const agentB = request.agent(app);

        await agentA.post("/auth/login").send({ email: user.email, password: PASSWORD });
        await agentB.post("/auth/login").send({ email: user.email, password: PASSWORD });

        const out = await agentA.post("/auth/logout-all");
        expect(out.status).toBe(200);

        for (const agent of [agentA, agentB]) {
            // Refresh sessions are gone...
            const refreshed = await agent.post("/auth/refresh");
            expect(refreshed.status).toBe(401);
        }
        // ...while the short-lived access JWT still verifies statelessly until
        // its 15-minute expiry (by design; rotation/reuse checks live server-side).
    });

    it("does not rate-limit the suite (limiter skipped in test env)", async () => {
        const user = await createUser("rot4", "rot4@test.com");
        for (let i = 0; i < 25; i++) {
            const res = await request(app)
                .post("/auth/login")
                .send({ email: user.email, password: "wrong-password" });
            expect(res.status).toBe(401);
            expect(res.body.code).toBe("UNAUTHORIZED");
        }
    });
});
