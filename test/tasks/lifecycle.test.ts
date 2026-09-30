import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { createUser, loginCookies } from "../helpers/auth";
import { prisma } from "../../src/services/db";
import { Prisma } from "../../generated/prisma/client";

function newTaskPayload(title: string) {
    return {
        title,
        reward: 200,
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
    };
}

describe("task lifecycle end to end", () => {
    beforeEach(async () => {
        await resetDb();
    });

    it("runs OPEN -> proposal -> ASSIGNED -> SUBMITTED -> COMPLETED -> reviewed", async () => {
        const owner = await createUser("lc-owner", "lc-owner@test.com");
        const tasker = await createUser("lc-tasker", "lc-tasker@test.com");
        const ownerCookies = await loginCookies({ email: owner.email });
        const taskerCookies = await loginCookies({ email: tasker.email });

        const created = await request(app)
            .post("/tasks")
            .set("Cookie", ownerCookies)
            .send(newTaskPayload("Lifecycle job"));
        expect(created.status).toBe(201);
        const taskId = created.body.data.task.id as string;

        const proposed = await request(app)
            .post(`/tasks/${taskId}/proposals`)
            .set("Cookie", taskerCookies)
            .send({ title: "I can do this today", body: "Experienced and ready to help" });
        expect(proposed.status).toBe(201);

        // Duplicate proposal is rejected.
        const dup = await request(app)
            .post(`/tasks/${taskId}/proposals`)
            .set("Cookie", taskerCookies)
            .send({ title: "Again", body: "Second attempt at bidding" });
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe("ALREADY_EXISTS");

        const assigned = await request(app)
            .post(`/tasks/${taskId}/assign`)
            .set("Cookie", ownerCookies)
            .send({ userId: tasker.id });
        expect(assigned.status).toBe(200);
        expect(assigned.body.data.task.status).toBe("ASSIGNED");

        const submitted = await request(app)
            .post(`/tasks/${taskId}/submit`)
            .set("Cookie", taskerCookies);
        expect(submitted.status).toBe(200);
        expect(submitted.body.data.task.status).toBe("SUBMITTED");

        const confirmed = await request(app)
            .post(`/tasks/${taskId}/confirm`)
            .set("Cookie", ownerCookies);
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.data.task.status).toBe("COMPLETED");

        const reviewed = await request(app)
            .post(`/tasks/${taskId}/review`)
            .set("Cookie", ownerCookies)
            .send({ stars: 5, comment: "Great communication and very reliable." });
        expect(reviewed.status).toBe(201);
        expect(reviewed.body.data.tasker.ratingAvg).toBe(5);
        expect(reviewed.body.data.tasker.ratingCount).toBe(1);

        // Second review on the same task is rejected.
        const dupReview = await request(app)
            .post(`/tasks/${taskId}/review`)
            .set("Cookie", ownerCookies)
            .send({ stars: 1, comment: "Trying to double review." });
        expect(dupReview.status).toBe(409);
        expect(dupReview.body.code).toBe("ALREADY_EXISTS");
    });

    it("averages ratings across tasks", async () => {
        const owner = await createUser("lc-owner2", "lc-owner2@test.com");
        const tasker = await createUser("lc-tasker2", "lc-tasker2@test.com");
        const ownerCookies = await loginCookies({ email: owner.email });
        const taskerCookies = await loginCookies({ email: tasker.email });

        for (const [title, stars] of [["First job", 5], ["Second job", 3]] as const) {
            const created = await request(app)
                .post("/tasks")
                .set("Cookie", ownerCookies)
                .send(newTaskPayload(title));
            const taskId = created.body.data.task.id as string;
            await request(app)
                .post(`/tasks/${taskId}/proposals`)
                .set("Cookie", taskerCookies)
                .send({ title: "Bid", body: "Proposal body goes here" });
            await request(app)
                .post(`/tasks/${taskId}/assign`)
                .set("Cookie", ownerCookies)
                .send({ userId: tasker.id });
            await request(app).post(`/tasks/${taskId}/submit`).set("Cookie", taskerCookies);
            await request(app).post(`/tasks/${taskId}/confirm`).set("Cookie", ownerCookies);
            const reviewed = await request(app)
                .post(`/tasks/${taskId}/review`)
                .set("Cookie", ownerCookies)
                .send({ stars, comment: `Rated ${stars} stars here` });
            expect(reviewed.status).toBe(201);
        }

        const row = await prisma.user.findUnique({ where: { id: tasker.id } });
        expect(row?.ratingCount).toBe(2);
        expect(row?.ratingAvg).toBeCloseTo(4, 5);

        const profile = await request(app)
            .get(`/users/${tasker.id}/public`)
            .set("Cookie", ownerCookies);
        expect(profile.body.data.user.ratingAvg).toBeCloseTo(4, 5);
        expect(profile.body.data.user.completedAsTasker).toBe(2);
    });

    it("rejects completion shortcuts outside the order", async () => {
        const owner = await createUser("lc-owner3", "lc-owner3@test.com");
        const tasker = await createUser("lc-tasker3", "lc-tasker3@test.com");
        const ownerCookies = await loginCookies({ email: owner.email });

        const created = await request(app)
            .post("/tasks")
            .set("Cookie", ownerCookies)
            .send(newTaskPayload("Shortcut job"));
        const taskId = created.body.data.task.id as string;

        // Confirm before submit.
        const early = await request(app).post(`/tasks/${taskId}/confirm`).set("Cookie", ownerCookies);
        expect(early.status).toBe(409);

        // Review before completion.
        const earlyReview = await request(app)
            .post(`/tasks/${taskId}/review`)
            .set("Cookie", ownerCookies)
            .send({ stars: 5, comment: "Too early for this review" });
        expect(earlyReview.status).toBe(403);

        // Owner cannot propose on their own task.
        const own = await request(app)
            .post(`/tasks/${taskId}/proposals`)
            .set("Cookie", ownerCookies)
            .send({ title: "Self bid", body: "Owner bidding on own task" });
        expect(own.status).toBe(403);

        // Assigning a stranger who never proposed is forbidden.
        const strangerAssign = await request(app)
            .post(`/tasks/${taskId}/assign`)
            .set("Cookie", ownerCookies)
            .send({ userId: tasker.id });
        expect(strangerAssign.status).toBe(403);
    });
});
