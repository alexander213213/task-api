import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { createUser, loginCookies } from "../helpers/auth";
import { prisma } from "../../src/services/db";
import { Prisma } from "../../generated/prisma/client";
import { TaskStatus } from "../../generated/prisma/enums";

async function createTask(ownerId: string, title = "Searchable plumbing job", reward = 300) {
    return prisma.task.create({
        data: {
            title,
            reward: new Prisma.Decimal(reward),
            deadline: new Date(Date.now() + 86_400_000),
            ownerId,
            status: TaskStatus.OPEN,
        },
        select: { id: true },
    });
}

describe("proposals, reviews, users, search", () => {
    beforeEach(async () => {
        await resetDb();
    });

    describe("PATCH /tasks/:taskId/proposals/me", () => {
        it("edits your own proposal on an OPEN task", async () => {
            const owner = await createUser("pr-owner1", "pr-owner1@test.com");
            const bidder = await createUser("pr-bidder1", "pr-bidder1@test.com");
            const { id } = await createTask(owner.id);
            const bidderCookies = await loginCookies({ email: bidder.email });

            await request(app)
                .post(`/tasks/${id}/proposals`)
                .set("Cookie", bidderCookies)
                .send({ title: "First draft", body: "I can do this work well" });

            const res = await request(app)
                .patch(`/tasks/${id}/proposals/me`)
                .set("Cookie", bidderCookies)
                .send({ title: "Revised bid", body: "Updated plan with timeline" });

            expect(res.status).toBe(200);
            expect(res.body.data.proposal.title).toBe("Revised bid");
        });

        it("returns 404 when editing someone else's proposal slot", async () => {
            const owner = await createUser("pr-owner2", "pr-owner2@test.com");
            const bidder = await createUser("pr-bidder2", "pr-bidder2@test.com");
            const stranger = await createUser("pr-stranger2", "pr-stranger2@test.com");
            const { id } = await createTask(owner.id);
            const bidderCookies = await loginCookies({ email: bidder.email });
            const strangerCookies = await loginCookies({ email: stranger.email });

            await request(app)
                .post(`/tasks/${id}/proposals`)
                .set("Cookie", bidderCookies)
                .send({ title: "Mine", body: "My proposal body here" });

            const res = await request(app)
                .patch(`/tasks/${id}/proposals/me`)
                .set("Cookie", strangerCookies)
                .send({ title: "Hijack", body: "Trying to edit another bid" });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe("NOT_FOUND");
        });

        it("rejects edits once the task leaves OPEN with 409", async () => {
            const owner = await createUser("pr-owner3", "pr-owner3@test.com");
            const bidder = await createUser("pr-bidder3", "pr-bidder3@test.com");
            const { id } = await createTask(owner.id);
            const bidderCookies = await loginCookies({ email: bidder.email });
            const ownerCookies = await loginCookies({ email: owner.email });

            await request(app)
                .post(`/tasks/${id}/proposals`)
                .set("Cookie", bidderCookies)
                .send({ title: "Bid", body: "My proposal body here" });
            await request(app)
                .post(`/tasks/${id}/assign`)
                .set("Cookie", ownerCookies)
                .send({ userId: bidder.id });

            const res = await request(app)
                .patch(`/tasks/${id}/proposals/me`)
                .set("Cookie", bidderCookies)
                .send({ title: "Late edit", body: "Too late for changes" });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe("CONFLICT_STATE");
        });

        it("validates the body with issues", async () => {
            const owner = await createUser("pr-owner4", "pr-owner4@test.com");
            const bidder = await createUser("pr-bidder4", "pr-bidder4@test.com");
            const { id } = await createTask(owner.id);
            const bidderCookies = await loginCookies({ email: bidder.email });

            const res = await request(app)
                .patch(`/tasks/${id}/proposals/me`)
                .set("Cookie", bidderCookies)
                .send({ title: "", body: "x" });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe("VALIDATION_ERROR");
            expect(Array.isArray(res.body.issues)).toBe(true);
        });
    });

    describe("DELETE /tasks/:taskId/proposals/me", () => {
        it("withdraws your proposal and is idempotent-safe via 404", async () => {
            const owner = await createUser("pr-owner5", "pr-owner5@test.com");
            const bidder = await createUser("pr-bidder5", "pr-bidder5@test.com");
            const { id } = await createTask(owner.id);
            const bidderCookies = await loginCookies({ email: bidder.email });

            await request(app)
                .post(`/tasks/${id}/proposals`)
                .set("Cookie", bidderCookies)
                .send({ title: "Bid", body: "My proposal body here" });

            const first = await request(app)
                .delete(`/tasks/${id}/proposals/me`)
                .set("Cookie", bidderCookies);
            expect(first.status).toBe(200);
            expect(first.body.data.taskId).toBe(id);

            const second = await request(app)
                .delete(`/tasks/${id}/proposals/me`)
                .set("Cookie", bidderCookies);
            expect(second.status).toBe(404);
        });

        it("rejects withdrawal after assignment with 409", async () => {
            const owner = await createUser("pr-owner6", "pr-owner6@test.com");
            const bidder = await createUser("pr-bidder6", "pr-bidder6@test.com");
            const { id } = await createTask(owner.id);
            const bidderCookies = await loginCookies({ email: bidder.email });
            const ownerCookies = await loginCookies({ email: owner.email });

            await request(app)
                .post(`/tasks/${id}/proposals`)
                .set("Cookie", bidderCookies)
                .send({ title: "Bid", body: "My proposal body here" });
            await request(app)
                .post(`/tasks/${id}/assign`)
                .set("Cookie", ownerCookies)
                .send({ userId: bidder.id });

            const res = await request(app)
                .delete(`/tasks/${id}/proposals/me`)
                .set("Cookie", bidderCookies);
            expect(res.status).toBe(409);
        });
    });

    describe("GET /tasks/:taskId/review", () => {
        it("returns null before review and the review after", async () => {
            const owner = await createUser("pr-owner7", "pr-owner7@test.com");
            const tasker = await createUser("pr-tasker7", "pr-tasker7@test.com");
            const { id } = await prisma.task.create({
                data: {
                    title: "Job",
                    reward: new Prisma.Decimal(100),
                    deadline: new Date(Date.now() + 86_400_000),
                    ownerId: owner.id,
                    taskerId: tasker.id,
                    status: TaskStatus.SUBMITTED,
                },
                select: { id: true },
            });
            const cookies = await loginCookies({ email: owner.email });

            const before = await request(app).get(`/tasks/${id}/review`).set("Cookie", cookies);
            expect(before.status).toBe(200);
            expect(before.body.data.review).toBeNull();

            await request(app).post(`/tasks/${id}/confirm`).set("Cookie", cookies);
            await request(app)
                .post(`/tasks/${id}/review`)
                .set("Cookie", cookies)
                .send({ stars: 4, comment: "Solid work" });

            const after = await request(app).get(`/tasks/${id}/review`).set("Cookie", cookies);
            expect(after.status).toBe(200);
            expect(after.body.data.review.stars).toBe(4);
        });
    });

    describe("users", () => {
        it("serves a public profile with counts", async () => {
            const owner = await createUser("pr-owner8", "pr-owner8@test.com");
            const tasker = await createUser("pr-tasker8", "pr-tasker8@test.com");
            await createTask(owner.id);
            const done = await prisma.task.create({
                data: {
                    title: "Done job",
                    reward: new Prisma.Decimal(100),
                    deadline: new Date(Date.now() + 86_400_000),
                    ownerId: owner.id,
                    taskerId: tasker.id,
                    status: TaskStatus.COMPLETED,
                },
                select: { id: true },
            });
            await prisma.review.create({
                data: { taskId: done.id, reviewerId: owner.id, revieweeId: tasker.id, stars: 5, comment: "Top" },
            });
            const cookies = await loginCookies({ email: owner.email });

            const res = await request(app).get(`/users/${tasker.id}/public`).set("Cookie", cookies);
            expect(res.status).toBe(200);
            expect(res.body.data.user.username).toBe(tasker.username);
            expect(res.body.data.user.completedAsTasker).toBe(1);
            expect(res.body.data.user.posted).toBe(0);

            const missing = await request(app).get("/users/nope/public").set("Cookie", cookies);
            expect(missing.status).toBe(404);
        });

        it("serves me/stats with accurate counts", async () => {
            const owner = await createUser("pr-owner9", "pr-owner9@test.com");
            const tasker = await createUser("pr-tasker9", "pr-tasker9@test.com");
            const { id } = await createTask(owner.id);
            await prisma.proposal.create({
                data: { taskId: id, userId: tasker.id, title: "Bid", body: "Body here" },
            });
            const ownerCookies = await loginCookies({ email: owner.email });
            const taskerCookies = await loginCookies({ email: tasker.email });

            const ownerStats = await request(app).get("/users/me/stats").set("Cookie", ownerCookies);
            expect(ownerStats.status).toBe(200);
            expect(ownerStats.body.data).toMatchObject({ posted: 1, active: 0, completedAsTasker: 0, proposalsSent: 0 });

            const taskerStats = await request(app).get("/users/me/stats").set("Cookie", taskerCookies);
            expect(taskerStats.body.data).toMatchObject({ posted: 0, active: 0, proposalsSent: 1 });
        });
    });

    describe("GET /tasks search", () => {
        it("filters by text, reward range, and deadline", async () => {
            const owner = await createUser("pr-owner10", "pr-owner10@test.com");
            const viewer = await createUser("pr-viewer10", "pr-viewer10@test.com");
            await createTask(owner.id, "Searchable plumbing job", 300);
            await createTask(owner.id, "Electrical wiring gig", 900);
            await createTask(owner.id, "Cheap errand run", 50);
            const cookies = await loginCookies({ email: viewer.email });

            const q = await request(app).get("/tasks?q=plumbing&limit=10").set("Cookie", cookies);
            expect(q.status).toBe(200);
            expect(q.body.data.tasks).toHaveLength(1);
            expect(q.body.data.tasks[0].title).toContain("plumbing");

            const range = await request(app)
                .get("/tasks?minReward=200&maxReward=500&limit=10")
                .set("Cookie", cookies);
            expect(range.status).toBe(200);
            expect(range.body.data.tasks).toHaveLength(1);

            const badRange = await request(app)
                .get("/tasks?minReward=500&maxReward=200")
                .set("Cookie", cookies);
            expect(badRange.status).toBe(400);
            expect(badRange.body.code).toBe("VALIDATION_ERROR");

            const future = await request(app)
                .get(`/tasks?deadlineFrom=${new Date(Date.now() + 2 * 86_400_000).toISOString()}&limit=10`)
                .set("Cookie", cookies);
            expect(future.status).toBe(200);
            expect(future.body.data.tasks).toHaveLength(0);
        });
    });
});
