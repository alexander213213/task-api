import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { createUser, loginCookies } from "../helpers/auth";
import { prisma } from "../../src/services/db";
import { Prisma } from "../../generated/prisma/client";
import { TaskStatus } from "../../generated/prisma/enums";

async function createTask(ownerId: string, overrides: Partial<{ status: TaskStatus; taskerId: string | null; title: string }> = {}) {
    return prisma.task.create({
        data: {
            title: overrides.title ?? "Detail task",
            reward: new Prisma.Decimal(250),
            deadline: new Date(Date.now() + 86_400_000),
            ownerId,
            taskerId: overrides.taskerId ?? null,
            status: overrides.status ?? TaskStatus.OPEN,
        },
        select: { id: true },
    });
}

describe("task read model", () => {
    beforeEach(async () => {
        await resetDb();
    });

    describe("GET /tasks/:taskId", () => {
        it("returns owner, counts, and nulls for tasker/review/myProposal", async () => {
            const owner = await createUser("r-owner1", "r-owner1@test.com");
            const viewer = await createUser("r-viewer1", "r-viewer1@test.com");
            const { id } = await createTask(owner.id);
            const cookies = await loginCookies({ email: viewer.email });

            const res = await request(app).get(`/tasks/${id}`).set("Cookie", cookies);
            expect(res.status).toBe(200);
            const task = res.body.data.task;
            expect(task.owner.username).toBe(owner.username);
            expect(task.owner.ratingAvg).toBeDefined();
            expect(task.tasker).toBeNull();
            expect(task.review).toBeNull();
            expect(task._count.proposals).toBe(0);
            expect(task.myProposal).toBeNull();
            expect(task.taskerId).toBeUndefined();
        });

        it("returns tasker, review, proposal count, and the viewer's proposal", async () => {
            const owner = await createUser("r-owner2", "r-owner2@test.com");
            const tasker = await createUser("r-tasker2", "r-tasker2@test.com");
            const { id } = await createTask(owner.id, { status: TaskStatus.COMPLETED, taskerId: tasker.id });

            await prisma.proposal.create({
                data: { taskId: id, userId: tasker.id, title: "I can do this", body: "Experienced" },
            });
            await prisma.review.create({
                data: { taskId: id, reviewerId: owner.id, revieweeId: tasker.id, stars: 5, comment: "Great" },
            });

            const cookies = await loginCookies({ email: tasker.email });
            const res = await request(app).get(`/tasks/${id}`).set("Cookie", cookies);
            expect(res.status).toBe(200);
            const task = res.body.data.task;
            expect(task.tasker.username).toBe(tasker.username);
            expect(task.review.stars).toBe(5);
            expect(task._count.proposals).toBe(1);
            expect(task.myProposal.title).toBe("I can do this");
        });

        it("returns 404 for unknown tasks", async () => {
            const viewer = await createUser("r-viewer3", "r-viewer3@test.com");
            const cookies = await loginCookies({ email: viewer.email });

            const res = await request(app).get("/tasks/does-not-exist").set("Cookie", cookies);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe("NOT_FOUND");
        });
    });

    describe("GET /tasks/me", () => {
        it("paginates newest-first with no duplicates", async () => {
            const owner = await createUser("r-owner4", "r-owner4@test.com");
            for (let i = 0; i < 5; i++) {
                await createTask(owner.id, { title: `Mine ${i}` });
            }
            const cookies = await loginCookies({ email: owner.email });

            const ids: string[] = [];
            let cursor: string | undefined;
            for (let p = 0; p < 5; p++) {
                const res = await request(app)
                    .get(`/tasks/me?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
                    .set("Cookie", cookies);
                expect(res.status).toBe(200);
                for (const t of res.body.data.tasks) ids.push(t.id as string);
                if (!res.body.data.hasNextPage) {
                    expect(res.body.data.nextCursor).toBeNull();
                    break;
                }
                cursor = res.body.data.nextCursor as string;
            }
            expect(ids).toHaveLength(5);
            expect(new Set(ids).size).toBe(5);
        });

        it("includes tasker info and proposal counts, and filters by status", async () => {
            const owner = await createUser("r-owner5", "r-owner5@test.com");
            const tasker = await createUser("r-tasker5", "r-tasker5@test.com");
            const open = await createTask(owner.id, { title: "Open one" });
            await createTask(owner.id, { title: "Assigned one", status: TaskStatus.ASSIGNED, taskerId: tasker.id });
            await prisma.proposal.create({
                data: { taskId: open.id, userId: tasker.id, title: "Bid", body: "Pick me" },
            });
            const cookies = await loginCookies({ email: owner.email });

            const all = await request(app).get("/tasks/me?limit=10").set("Cookie", cookies);
            expect(all.status).toBe(200);
            expect(all.body.data.tasks).toHaveLength(2);
            const openTask = (all.body.data.tasks as Array<any>).find((t) => t.id === open.id);
            expect(openTask._count.proposals).toBe(1);

            const filtered = await request(app).get("/tasks/me?status=ASSIGNED").set("Cookie", cookies);
            expect(filtered.status).toBe(200);
            expect(filtered.body.data.tasks).toHaveLength(1);
            expect(filtered.body.data.tasks[0].status).toBe("ASSIGNED");
            expect(filtered.body.data.tasks[0].tasker.username).toBe(tasker.username);
        });

        it("rejects invalid status and cursor with 400", async () => {
            const owner = await createUser("r-owner6", "r-owner6@test.com");
            const cookies = await loginCookies({ email: owner.email });

            const badStatus = await request(app).get("/tasks/me?status=BOGUS").set("Cookie", cookies);
            expect(badStatus.status).toBe(400);
            expect(badStatus.body.code).toBe("VALIDATION_ERROR");
            expect(Array.isArray(badStatus.body.issues)).toBe(true);

            const badCursor = await request(app).get("/tasks/me?cursor=junk").set("Cookie", cookies);
            expect(badCursor.status).toBe(400);
            expect(badCursor.body.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("GET /tasks/assigned/me", () => {
        it("paginates, includes owner info, and filters by status", async () => {
            const owner = await createUser("r-owner7", "r-owner7@test.com");
            const tasker = await createUser("r-tasker7", "r-tasker7@test.com");
            await createTask(owner.id, { title: "Job 1", status: TaskStatus.ASSIGNED, taskerId: tasker.id });
            await createTask(owner.id, { title: "Job 2", status: TaskStatus.SUBMITTED, taskerId: tasker.id });
            await createTask(owner.id, { title: "Not mine" });
            const cookies = await loginCookies({ email: tasker.email });

            const all = await request(app).get("/tasks/assigned/me?limit=10").set("Cookie", cookies);
            expect(all.status).toBe(200);
            expect(all.body.data.tasks).toHaveLength(2);
            expect(all.body.data.tasks[0].owner.username).toBe(owner.username);

            const filtered = await request(app)
                .get("/tasks/assigned/me?status=SUBMITTED")
                .set("Cookie", cookies);
            expect(filtered.status).toBe(200);
            expect(filtered.body.data.tasks).toHaveLength(1);
            expect(filtered.body.data.tasks[0].title).toBe("Job 2");
        });
    });
});
