import app from "../../src/server";
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import http from "http";
import { AddressInfo } from "net";
import { resetDb } from "../helpers/db";
import { createUser, loginCookies } from "../helpers/auth";
import { bus, TaskEvent } from "../../src/realtime/bus";

function newTaskPayload(title: string) {
    return {
        title,
        reward: 150,
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
    };
}

describe("realtime SSE", () => {
    beforeEach(async () => {
        bus.reset();
        await resetDb();
    });

    describe("event bus", () => {
        it("sequences ids, replays since(), and unsubscribes", () => {
            const seen: TaskEvent[] = [];
            const unsub = bus.subscribe((e) => seen.push(e));

            const first = bus.publish("task:created", ["*"], { id: "a" });
            const second = bus.publish("task:created", ["*"], { id: "b" });
            expect(second.id).toBe(first.id + 1);
            expect(seen).toHaveLength(2);

            expect(bus.since(first.id).map((e) => e.id)).toEqual([second.id]);

            unsub();
            bus.publish("task:created", ["*"], { id: "c" });
            expect(seen).toHaveLength(2);
        });
    });

    describe("GET /events", () => {
        it("rejects unauthenticated clients with 401", async () => {
            const res = await request(app).get("/events");
            expect(res.status).toBe(401);
            expect(res.body.code).toBe("UNAUTHORIZED");
        });
    });

    describe("emit wiring", () => {
        it("publishes lifecycle events to the right audience", async () => {
            const owner = await createUser("e-owner1", "e-owner1@test.com");
            const tasker = await createUser("e-tasker1", "e-tasker1@test.com");
            const ownerCookies = await loginCookies({ email: owner.email });
            const taskerCookies = await loginCookies({ email: tasker.email });

            const seen: TaskEvent[] = [];
            const unsub = bus.subscribe((e) => seen.push(e));
            try {
                const created = await request(app)
                    .post("/tasks")
                    .set("Cookie", ownerCookies)
                    .send(newTaskPayload("Lifecycle job"));
                expect(created.status).toBe(201);
                const taskId = created.body.data.task.id as string;

                const proposed = await request(app)
                    .post(`/tasks/${taskId}/proposals`)
                    .set("Cookie", taskerCookies)
                    .send({ title: "I can do this", body: "Experienced and ready" });
                expect(proposed.status).toBe(201);

                const assigned = await request(app)
                    .post(`/tasks/${taskId}/assign`)
                    .set("Cookie", ownerCookies)
                    .send({ userId: tasker.id });
                expect(assigned.status).toBe(200);

                const submitted = await request(app)
                    .post(`/tasks/${taskId}/submit`)
                    .set("Cookie", taskerCookies);
                expect(submitted.status).toBe(200);

                const confirmed = await request(app)
                    .post(`/tasks/${taskId}/confirm`)
                    .set("Cookie", ownerCookies);
                expect(confirmed.status).toBe(200);

                const reviewed = await request(app)
                    .post(`/tasks/${taskId}/review`)
                    .set("Cookie", ownerCookies)
                    .send({ stars: 5, comment: "Great work" });
                expect(reviewed.status).toBe(201);
            } finally {
                unsub();
            }

            const byType = (t: TaskEvent["type"]) => seen.filter((e) => e.type === t);
            expect(byType("task:created")).toHaveLength(1);
            expect(byType("task:created")[0]?.to).toEqual(["*"]);
            expect(byType("proposal:created")[0]?.to).toEqual([owner.id]);
            expect(byType("task:assigned")[0]?.to).toEqual([tasker.id]);
            expect(byType("task:submitted")[0]?.to).toEqual([owner.id]);
            expect(byType("task:confirmed")[0]?.to).toEqual([tasker.id]);
            expect(byType("review:received")[0]?.to).toEqual([tasker.id]);
            expect(seen).toHaveLength(6);
        });
    });

    describe("streaming", () => {
        let server: http.Server;
        let port: number;

        beforeAll(async () => {
            await new Promise<void>((resolve) => {
                server = app.listen(0, "127.0.0.1", () => resolve());
            });
            port = (server.address() as AddressInfo).port;
        });

        afterAll(async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        });

        it("delivers live events only to their audience", async () => {
            const owner = await createUser("e-owner2", "e-owner2@test.com");
            const tasker = await createUser("e-tasker2", "e-tasker2@test.com");
            const viewer = await createUser("e-viewer2", "e-viewer2@test.com");
            const ownerCookies = await loginCookies({ email: owner.email });
            const taskerCookies = await loginCookies({ email: tasker.email });
            const viewerCookies = await loginCookies({ email: viewer.email });

            const created = await request(app)
                .post("/tasks")
                .set("Cookie", ownerCookies)
                .send(newTaskPayload("Streamed job"));
            const taskId = created.body.data.task.id as string;
            await request(app)
                .post(`/tasks/${taskId}/proposals`)
                .set("Cookie", taskerCookies)
                .send({ title: "Bid", body: "Pick me" });

            const buf = await new Promise<string>((resolve, reject) => {
                let text = "";
                const timer = setTimeout(() => reject(new Error(`live stream timeout: ${text}`)), 5000);
                // Fires a private proposal event (addressed to the owner) while the
                // viewer is connected, then a broadcast task event. The viewer must
                // receive only the broadcast.
                const fire = async () => {
                    await request(app)
                        .post(`/tasks/${taskId}/proposals`)
                        .set("Cookie", taskerCookies)
                        .send({ title: "Second bid", body: "Still interested" });
                    await request(app)
                        .post("/tasks")
                        .set("Cookie", ownerCookies)
                        .send(newTaskPayload("Second streamed job"));
                };
                const req = http.get(
                    {
                        port,
                        host: "127.0.0.1",
                        path: "/events",
                        headers: { Cookie: viewerCookies.join("; ") },
                    },
                    (res) => {
                        try {
                            expect(res.headers["content-type"]).toBe("text/event-stream");
                        } catch (e) {
                            clearTimeout(timer);
                            reject(e);
                            return;
                        }
                        // Headers received => server subscribed; safe to publish.
                        void fire();
                        res.on("data", (c) => {
                            text += c.toString();
                            if (text.includes("Second streamed job")) {
                                clearTimeout(timer);
                                req.destroy();
                                resolve(text);
                            }
                        });
                    }
                );
                req.on("error", (e) => {
                    clearTimeout(timer);
                    reject(e);
                });
            });

            expect(buf).toContain("event: task:created");
            expect(buf).not.toContain("proposal:created");
        });

        it("replays missed events on Last-Event-ID resume", async () => {
            const owner = await createUser("e-owner3", "e-owner3@test.com");
            const viewer = await createUser("e-viewer3", "e-viewer3@test.com");
            const ownerCookies = await loginCookies({ email: owner.email });
            const viewerCookies = await loginCookies({ email: viewer.email });

            let publishedId = 0;
            const unsub = bus.subscribe((e) => {
                publishedId = e.id;
            });
            await request(app)
                .post("/tasks")
                .set("Cookie", ownerCookies)
                .send(newTaskPayload("Missed job"));
            unsub();

            const buf = await new Promise<string>((resolve, reject) => {
                let text = "";
                const timer = setTimeout(() => reject(new Error(`resume timeout: ${text}`)), 5000);
                const req = http.get(
                    {
                        port,
                        host: "127.0.0.1",
                        path: "/events",
                        headers: {
                            Cookie: viewerCookies.join("; "),
                            "Last-Event-ID": String(publishedId - 1),
                        },
                    },
                    (res) => {
                        res.on("data", (c) => {
                            text += c.toString();
                            if (text.includes("Missed job")) {
                                clearTimeout(timer);
                                req.destroy();
                                resolve(text);
                            }
                        });
                    }
                );
                req.on("error", (e) => {
                    clearTimeout(timer);
                    reject(e);
                });
            });

            expect(buf).toContain("event: task:created");
        });
    });
});
