import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { prisma } from "../../src/services/db";
import { Prisma } from "../../generated/prisma/client";
import { hash } from "bcrypt";

const PASSWORD = "Password123!";

async function createUser(username: string, email: string) {
    return prisma.user.create({
        data: {
            username,
            email,
            firstName: "Test",
            lastName: "User",
            passwordHash: await hash(PASSWORD, 4),
        },
    });
}

async function loginCookies(identifier: { email: string }) {
    const res = await request(app).post("/auth/login").send({ ...identifier, password: PASSWORD });
    expect(res.status).toBe(200);
    return (res.headers["set-cookie"] ?? []) as string[];
}

/** 7 OPEN tasks with distinct createdAt/reward/deadline, all owned by ownerId. */
async function seedTasks(ownerId: string) {
    const now = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
        const task = await prisma.task.create({
            data: {
                title: `Task ${i}`,
                reward: new Prisma.Decimal((i + 1) * 100),
                createdAt: new Date(now - i * 3_600_000),
                deadline: new Date(now + (7 - i) * 86_400_000),
                ownerId,
                status: "OPEN",
            },
            select: { id: true },
        });
        ids.push(task.id);
    }
    return ids;
}

async function walkFeed(
    cookies: string[],
    query: string
): Promise<{ ids: string[]; pages: number }> {
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (let i = 0; i < 10; i++) {
        const path = `/tasks?${query}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const res = await request(app).get(path).set("Cookie", cookies);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        for (const t of res.body.tasks as Array<{ id: string }>) ids.push(t.id);
        pages++;
        if (!res.body.hasNextPage) {
            expect(res.body.nextCursor).toBeNull();
            break;
        }
        expect(typeof res.body.nextCursor).toBe("string");
        cursor = res.body.nextCursor as string;
    }
    return { ids, pages };
}

describe("GET /tasks pagination", () => {
    beforeEach(async () => {
        await resetDb();
    });

    it("defaults to newest sort when sort_by is omitted", async () => {
        const owner = await createUser("owner1", "owner1@test.com");
        const viewer = await createUser("viewer1", "viewer1@test.com");
        await seedTasks(owner.id);
        const cookies = await loginCookies({ email: viewer.email });

        const res = await request(app).get("/tasks?limit=7").set("Cookie", cookies);
        expect(res.status).toBe(200);
        const tasks = res.body.tasks as Array<{ id: string; createdAt: string }>;
        expect(tasks).toHaveLength(7);
        const times = tasks.map((t) => new Date(t.createdAt).getTime());
        expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it("walks all pages without duplicates for every sort", async () => {
        const owner = await createUser("owner2", "owner2@test.com");
        const viewer = await createUser("viewer2", "viewer2@test.com");
        await seedTasks(owner.id);
        const cookies = await loginCookies({ email: viewer.email });

        for (const sort of ["newest", "reward_desc", "deadline_soon"]) {
            const { ids, pages } = await walkFeed(cookies, `sort_by=${sort}`);
            expect(ids).toHaveLength(7);
            expect(new Set(ids).size).toBe(7);
            expect(pages).toBe(3); // 3 + 3 + 1
        }
    });

    it("returns reward_desc in strictly descending reward order", async () => {
        const owner = await createUser("owner3", "owner3@test.com");
        const viewer = await createUser("viewer3", "viewer3@test.com");
        await seedTasks(owner.id);
        const cookies = await loginCookies({ email: viewer.email });

        const { ids } = await walkFeed(cookies, "sort_by=reward_desc");
        const tasks = await prisma.task.findMany({
            where: { id: { in: ids } },
            select: { id: true, reward: true },
        });
        const rewardOf = new Map(tasks.map((t) => [t.id, Number(t.reward)]));
        const rewards = ids.map((id) => rewardOf.get(id));
        expect([...rewards].sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual(rewards);
    });

    it("returns deadline_soon in ascending deadline order", async () => {
        const owner = await createUser("owner4", "owner4@test.com");
        const viewer = await createUser("viewer4", "viewer4@test.com");
        await seedTasks(owner.id);
        const cookies = await loginCookies({ email: viewer.email });

        const res = await request(app)
            .get("/tasks?sort_by=deadline_soon&limit=7")
            .set("Cookie", cookies);
        expect(res.status).toBe(200);
        const tasks = res.body.tasks as Array<{ deadline: string }>;
        const times = tasks.map((t) => new Date(t.deadline).getTime());
        expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it("rejects garbage cursors with 400", async () => {
        const owner = await createUser("owner5", "owner5@test.com");
        const viewer = await createUser("viewer5", "viewer5@test.com");
        await seedTasks(owner.id);
        const cookies = await loginCookies({ email: viewer.email });

        for (const bad of ["not-a-cursor", "cmV3cmRfZGVzY3x8", "12345"]) {
            const res = await request(app)
                .get(`/tasks?sort_by=newest&cursor=${bad}`)
                .set("Cookie", cookies);
            expect(res.status).toBe(400);
            expect(res.body.ok).toBe(false);
        }
    });

    it("rejects a cursor minted for a different sort with 400", async () => {
        const owner = await createUser("owner6", "owner6@test.com");
        const viewer = await createUser("viewer6", "viewer6@test.com");
        await seedTasks(owner.id);
        const cookies = await loginCookies({ email: viewer.email });

        const first = await request(app)
            .get("/tasks?sort_by=newest&limit=3")
            .set("Cookie", cookies);
        expect(first.status).toBe(200);
        const cursor = first.body.nextCursor as string;

        const res = await request(app)
            .get(`/tasks?sort_by=reward_desc&limit=3&cursor=${encodeURIComponent(cursor)}`)
            .set("Cookie", cookies);
        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });
});
