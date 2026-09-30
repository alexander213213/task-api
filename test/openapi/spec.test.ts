import app from "../../src/server";
import { describe, it, expect } from "vitest";
import request from "supertest";

const EXPECTED_PATHS = [
    "/auth/register",
    "/auth/login",
    "/auth/refresh",
    "/auth/logout",
    "/auth/logout-all",
    "/auth/me",
    "/auth/exist",
    "/auth/google",
    "/auth/google/link",
    "/tasks",
    "/tasks/me",
    "/tasks/assigned/me",
    "/tasks/{taskId}",
    "/tasks/{taskId}/proposals",
    "/tasks/{taskId}/proposals/me",
    "/tasks/{taskId}/assign",
    "/tasks/{taskId}/submit",
    "/tasks/{taskId}/confirm",
    "/tasks/{taskId}/review",
    "/tasks/{taskId}/cancel",
    "/tasks/{taskId}/unassign",
    "/users/me/stats",
    "/users/{id}/public",
    "/events",
    "/health",
];

describe("openapi", () => {
    it("serves a spec covering every route", async () => {
        const res = await request(app).get("/openapi.json");
        expect(res.status).toBe(200);
        expect(res.body.openapi).toMatch(/^3\.0\./);
        const paths = Object.keys(res.body.paths ?? {});
        for (const p of EXPECTED_PATHS) {
            expect(paths).toContain(p);
        }
    });

    it("serves the Scalar UI", async () => {
        const res = await request(app).get("/openapi");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
    });
});
