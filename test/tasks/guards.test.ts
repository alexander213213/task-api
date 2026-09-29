import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { createUser, loginCookies } from "../helpers/auth";
import { prisma } from "../../src/services/db";
import { Prisma } from "../../generated/prisma/client";
import { TaskStatus } from "../../generated/prisma/enums";

async function createTask(ownerId: string, status: TaskStatus, taskerId?: string) {
    return prisma.task.create({
        data: {
            title: `${status} task`,
            reward: new Prisma.Decimal(100),
            deadline: new Date(Date.now() + 86_400_000),
            ownerId,
            taskerId: taskerId ?? null,
            status,
        },
        select: { id: true },
    });
}

describe("task guards", () => {
    beforeEach(async () => {
        await resetDb();
    });

    describe("PATCH /tasks/:taskId", () => {
        it("allows the owner to edit an OPEN task", async () => {
            const owner = await createUser("p-owner1", "p-owner1@test.com");
            await createUser("p-other1", "p-other1@test.com");
            const { id } = await createTask(owner.id, TaskStatus.OPEN);
            const cookies = await loginCookies({ email: owner.email });

            const res = await request(app)
                .patch(`/tasks/${id}`)
                .set("Cookie", cookies)
                .send({ op: "replace", path: "/title", value: "New title" });

            expect(res.status).toBe(200);
            expect(res.body.data.task.title).toBe("New title");
        });

        it("rejects edits on non-OPEN tasks with 409", async () => {
            const owner = await createUser("p-owner2", "p-owner2@test.com");
            const tasker = await createUser("p-tasker2", "p-tasker2@test.com");
            const cookies = await loginCookies({ email: owner.email });

            for (const status of [TaskStatus.ASSIGNED, TaskStatus.SUBMITTED, TaskStatus.COMPLETED, TaskStatus.CANCELLED]) {
                const { id } = await createTask(owner.id, status, tasker.id);
                const res = await request(app)
                    .patch(`/tasks/${id}`)
                    .set("Cookie", cookies)
                    .send({ op: "replace", path: "/title", value: "New title" });

                expect(res.status).toBe(409);
                expect(res.body).toMatchObject({ ok: false, code: "CONFLICT_STATE" });
            }
        });

        it("rejects edits by non-owners with 403", async () => {
            const owner = await createUser("p-owner3", "p-owner3@test.com");
            const other = await createUser("p-other3", "p-other3@test.com");
            const { id } = await createTask(owner.id, TaskStatus.OPEN);
            const cookies = await loginCookies({ email: other.email });

            const res = await request(app)
                .patch(`/tasks/${id}`)
                .set("Cookie", cookies)
                .send({ op: "replace", path: "/title", value: "Hijack" });

            expect(res.status).toBe(403);
            expect(res.body.code).toBe("FORBIDDEN");
        });
    });

    describe("DELETE /tasks/:taskId", () => {
        it("deletes OPEN and CANCELLED tasks", async () => {
            const owner = await createUser("d-owner1", "d-owner1@test.com");
            const cookies = await loginCookies({ email: owner.email });

            for (const status of [TaskStatus.OPEN, TaskStatus.CANCELLED]) {
                const { id } = await createTask(owner.id, status);
                const res = await request(app).delete(`/tasks/${id}`).set("Cookie", cookies);
                expect(res.status).toBe(200);
                expect(res.body.data.task.id).toBe(id);
            }
        });

        it("rejects deleting ASSIGNED/SUBMITTED/COMPLETED tasks with 409", async () => {
            const owner = await createUser("d-owner2", "d-owner2@test.com");
            const tasker = await createUser("d-tasker2", "d-tasker2@test.com");
            const cookies = await loginCookies({ email: owner.email });

            for (const status of [TaskStatus.ASSIGNED, TaskStatus.SUBMITTED, TaskStatus.COMPLETED]) {
                const { id } = await createTask(owner.id, status, tasker.id);
                const res = await request(app).delete(`/tasks/${id}`).set("Cookie", cookies);
                expect(res.status).toBe(409);
                expect(res.body.code).toBe("CONFLICT_STATE");
            }
        });

        it("rejects deletes by non-owners with 403", async () => {
            const owner = await createUser("d-owner3", "d-owner3@test.com");
            const other = await createUser("d-other3", "d-other3@test.com");
            const { id } = await createTask(owner.id, TaskStatus.OPEN);
            const cookies = await loginCookies({ email: other.email });

            const res = await request(app).delete(`/tasks/${id}`).set("Cookie", cookies);
            expect(res.status).toBe(403);
        });
    });

    describe("POST /tasks/:taskId/submit", () => {
        it("lets the tasker submit an ASSIGNED task", async () => {
            const owner = await createUser("s-owner1", "s-owner1@test.com");
            const tasker = await createUser("s-tasker1", "s-tasker1@test.com");
            const { id } = await createTask(owner.id, TaskStatus.ASSIGNED, tasker.id);
            const cookies = await loginCookies({ email: tasker.email });

            const res = await request(app).post(`/tasks/${id}/submit`).set("Cookie", cookies);
            expect(res.status).toBe(200);
            expect(res.body.data.task.status).toBe("SUBMITTED");
        });

        it("returns 403 when the caller is not the tasker", async () => {
            const owner = await createUser("s-owner2", "s-owner2@test.com");
            const tasker = await createUser("s-tasker2", "s-tasker2@test.com");
            const { id } = await createTask(owner.id, TaskStatus.ASSIGNED, tasker.id);
            const cookies = await loginCookies({ email: owner.email });

            const res = await request(app).post(`/tasks/${id}/submit`).set("Cookie", cookies);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe("FORBIDDEN");
        });

        it("returns 409 when the tasker submits a task in the wrong state", async () => {
            const owner = await createUser("s-owner3", "s-owner3@test.com");
            const tasker = await createUser("s-tasker3", "s-tasker3@test.com");
            const { id } = await createTask(owner.id, TaskStatus.COMPLETED, tasker.id);
            const cookies = await loginCookies({ email: tasker.email });

            const res = await request(app).post(`/tasks/${id}/submit`).set("Cookie", cookies);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe("CONFLICT_STATE");
        });
    });

    describe("POST /tasks/:taskId/confirm", () => {
        it("lets the owner confirm a SUBMITTED task", async () => {
            const owner = await createUser("c-owner1", "c-owner1@test.com");
            const tasker = await createUser("c-tasker1", "c-tasker1@test.com");
            const { id } = await createTask(owner.id, TaskStatus.SUBMITTED, tasker.id);
            const cookies = await loginCookies({ email: owner.email });

            const res = await request(app).post(`/tasks/${id}/confirm`).set("Cookie", cookies);
            expect(res.status).toBe(200);
            expect(res.body.data.task.status).toBe("COMPLETED");
        });

        it("returns 409 when the owner confirms a task that is not SUBMITTED", async () => {
            const owner = await createUser("c-owner2", "c-owner2@test.com");
            const tasker = await createUser("c-tasker2", "c-tasker2@test.com");
            const { id } = await createTask(owner.id, TaskStatus.ASSIGNED, tasker.id);
            const cookies = await loginCookies({ email: owner.email });

            const res = await request(app).post(`/tasks/${id}/confirm`).set("Cookie", cookies);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe("CONFLICT_STATE");
        });

        it("returns 403 when a non-owner confirms", async () => {
            const owner = await createUser("c-owner3", "c-owner3@test.com");
            const tasker = await createUser("c-tasker3", "c-tasker3@test.com");
            const { id } = await createTask(owner.id, TaskStatus.SUBMITTED, tasker.id);
            const cookies = await loginCookies({ email: tasker.email });

            const res = await request(app).post(`/tasks/${id}/confirm`).set("Cookie", cookies);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe("FORBIDDEN");
        });
    });
});
