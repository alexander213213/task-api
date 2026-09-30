import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { createUser, loginCookies } from "../helpers/auth";
import { prisma } from "../../src/services/db";
import { Prisma } from "../../generated/prisma/client";
import { TaskStatus } from "../../generated/prisma/enums";

async function createOpenTask(ownerId: string, title = "Cancellable job") {
    return prisma.task.create({
        data: {
            title,
            reward: new Prisma.Decimal(120),
            deadline: new Date(Date.now() + 86_400_000),
            ownerId,
            status: TaskStatus.OPEN,
        },
        select: { id: true },
    });
}

describe("cancel, unassign, and misc endpoints", () => {
    beforeEach(async () => {
        await resetDb();
    });

    it("cancels an OPEN task and rejects cancelling anything else", async () => {
        const owner = await createUser("tr-owner1", "tr-owner1@test.com");
        const tasker = await createUser("tr-tasker1", "tr-tasker1@test.com");
        const ownerCookies = await loginCookies({ email: owner.email });

        const { id } = await createOpenTask(owner.id);
        const cancelled = await request(app).post(`/tasks/${id}/cancel`).set("Cookie", ownerCookies);
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data.task.status).toBe("CANCELLED");

        const again = await request(app).post(`/tasks/${id}/cancel`).set("Cookie", ownerCookies);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("CONFLICT_STATE");

        const { id: assignedId } = await prisma.task.create({
            data: {
                title: "Assigned job",
                reward: new Prisma.Decimal(100),
                deadline: new Date(Date.now() + 86_400_000),
                ownerId: owner.id,
                taskerId: tasker.id,
                status: TaskStatus.ASSIGNED,
            },
            select: { id: true },
        });
        const badCancel = await request(app).post(`/tasks/${assignedId}/cancel`).set("Cookie", ownerCookies);
        expect(badCancel.status).toBe(409);

        const taskerCookies = await loginCookies({ email: tasker.email });
        const forbidden = await request(app).post(`/tasks/${assignedId}/cancel`).set("Cookie", taskerCookies);
        expect(forbidden.status).toBe(403);
    });

    it("unassigns ASSIGNED/SUBMITTED tasks back to OPEN", async () => {
        const owner = await createUser("tr-owner2", "tr-owner2@test.com");
        const tasker = await createUser("tr-tasker2", "tr-tasker2@test.com");
        const stranger = await createUser("tr-stranger2", "tr-stranger2@test.com");
        const ownerCookies = await loginCookies({ email: owner.email });
        const strangerCookies = await loginCookies({ email: stranger.email });

        const { id } = await prisma.task.create({
            data: {
                title: "Rework job",
                reward: new Prisma.Decimal(100),
                deadline: new Date(Date.now() + 86_400_000),
                ownerId: owner.id,
                taskerId: tasker.id,
                status: TaskStatus.SUBMITTED,
            },
            select: { id: true },
        });

        const denied = await request(app).post(`/tasks/${id}/unassign`).set("Cookie", strangerCookies);
        expect(denied.status).toBe(403);

        const undone = await request(app).post(`/tasks/${id}/unassign`).set("Cookie", ownerCookies);
        expect(undone.status).toBe(200);
        expect(undone.body.data.task.status).toBe("OPEN");

        const openAgain = await request(app).post(`/tasks/${id}/unassign`).set("Cookie", ownerCookies);
        expect(openAgain.status).toBe(409);
    });

    it("edits task fields via JSON-patch ops", async () => {
        const owner = await createUser("tr-owner3", "tr-owner3@test.com");
        const ownerCookies = await loginCookies({ email: owner.email });
        const { id } = await createOpenTask(owner.id);

        const reward = await request(app)
            .patch(`/tasks/${id}`)
            .set("Cookie", ownerCookies)
            .send({ op: "replace", path: "/reward", value: 450 });
        expect(reward.status).toBe(200);
        expect(Number(reward.body.data.task.reward)).toBe(450);

        const deadline = new Date(Date.now() + 2 * 86_400_000).toISOString();
        const dl = await request(app)
            .patch(`/tasks/${id}`)
            .set("Cookie", ownerCookies)
            .send({ op: "replace", path: "/deadline", value: deadline });
        expect(dl.status).toBe(200);

        const badReward = await request(app)
            .patch(`/tasks/${id}`)
            .set("Cookie", ownerCookies)
            .send({ op: "replace", path: "/reward", value: -5 });
        expect(badReward.status).toBe(400);

        const removed = await request(app)
            .patch(`/tasks/${id}`)
            .set("Cookie", ownerCookies)
            .send({ op: "remove", path: "/description" });
        expect(removed.status).toBe(200);
    });

    it("answers existence checks", async () => {
        const owner = await createUser("tr-owner4", "tr-owner4@test.com");
        await loginCookies({ email: owner.email });

        const found = await request(app).get("/auth/exist?username=tr-owner4");
        expect(found.status).toBe(200);
        expect(found.body.data.exists).toBe(true);

        const missing = await request(app).get("/auth/exist?email=nobody@test.com");
        expect(missing.status).toBe(200);
        expect(missing.body.data.exists).toBe(false);

        const bad = await request(app).get("/auth/exist");
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe("VALIDATION_ERROR");
    });
});
