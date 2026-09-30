import app from "../../src/server";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { resetDb } from "../helpers/db";
import { prisma } from "../../src/services/db";
import { hash } from "bcrypt";
import { __setGoogleVerifier, GoogleProfile } from "../../src/services/google";

const PASSWORD = "Password123!";

function mockGoogle(profile: Partial<GoogleProfile> & { sub: string; email: string }) {
    __setGoogleVerifier(async () => ({
        emailVerified: true,
        ...profile,
    }));
}

function mockGoogleFailure() {
    __setGoogleVerifier(async () => {
        throw new Error("Invalid Google token");
    });
}

describe("Google auth", () => {
    beforeEach(async () => {
        await resetDb();
    });

    afterEach(() => {
        __setGoogleVerifier(null);
    });

    it("creates a Google user on first login with 201", async () => {
        mockGoogle({ sub: "google-sub-1", email: "gnew@test.com", givenName: "Gina", familyName: "New" });

        const res = await request(app).post("/auth/google").send({ idToken: "token" });

        expect(res.status).toBe(201);
        expect(res.body.ok).toBe(true);
        expect(res.body.data.user.email).toBe("gnew@test.com");
        expect(res.body.data.user.provider).toBe("GOOGLE");
        expect(res.body.data.user.passwordHash).toBeUndefined();

        const row = await prisma.user.findUnique({ where: { email: "gnew@test.com" } });
        expect(row?.googleId).toBe("google-sub-1");
        expect(row?.passwordHash).toBeNull();
        expect(row?.emailVerifiedAt).not.toBeNull();

        const cookies = (res.headers["set-cookie"] ?? []) as string[];
        expect(cookies.some((c) => c.startsWith("access_token="))).toBe(true);
        expect(cookies.some((c) => c.startsWith("refresh_token="))).toBe(true);
    });

    it("logs in a linked Google user with 200", async () => {
        await prisma.user.create({
            data: {
                email: "glinked@test.com",
                username: "glinked1",
                firstName: "G",
                lastName: "L",
                passwordHash: null,
                googleId: "google-sub-2",
                provider: "GOOGLE",
                emailVerifiedAt: new Date(),
            },
        });
        mockGoogle({ sub: "google-sub-2", email: "glinked@test.com" });

        const res = await request(app).post("/auth/google").send({ idToken: "token" });

        expect(res.status).toBe(200);
        expect(res.body.data.user.username).toBe("glinked1");
    });

    it("returns 409 GOOGLE_LINK_REQUIRED for an existing password email without auto-linking", async () => {
        await prisma.user.create({
            data: {
                email: "taken@test.com",
                username: "takenuser",
                firstName: "T",
                lastName: "U",
                passwordHash: await hash(PASSWORD, 4),
            },
        });
        mockGoogle({ sub: "google-sub-3", email: "taken@test.com" });

        const res = await request(app).post("/auth/google").send({ idToken: "token" });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("GOOGLE_LINK_REQUIRED");

        const row = await prisma.user.findUnique({ where: { email: "taken@test.com" } });
        expect(row?.googleId).toBeNull();
        expect(row?.provider).toBe("PASSWORD");
    });

    it("links Google after password proof via /auth/google/link", async () => {
        await prisma.user.create({
            data: {
                email: "linkme@test.com",
                username: "linkmeuser",
                firstName: "L",
                lastName: "U",
                passwordHash: await hash(PASSWORD, 4),
            },
        });
        mockGoogle({ sub: "google-sub-4", email: "linkme@test.com" });

        const res = await request(app)
            .post("/auth/google/link")
            .send({ idToken: "token", password: PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.data.user.provider).toBe("BOTH");

        const row = await prisma.user.findUnique({ where: { email: "linkme@test.com" } });
        expect(row?.googleId).toBe("google-sub-4");
        expect(row?.emailVerifiedAt).not.toBeNull();

        // Linked sub can now log in directly.
        const direct = await request(app).post("/auth/google").send({ idToken: "token" });
        expect(direct.status).toBe(200);
    });

    it("rejects linking with a wrong password using the same message as unknown email", async () => {
        await prisma.user.create({
            data: {
                email: "linkfail@test.com",
                username: "linkfailuser",
                firstName: "L",
                lastName: "U",
                passwordHash: await hash(PASSWORD, 4),
            },
        });
        mockGoogle({ sub: "google-sub-5", email: "linkfail@test.com" });

        const wrong = await request(app)
            .post("/auth/google/link")
            .send({ idToken: "token", password: "WrongPassword1" });
        expect(wrong.status).toBe(401);
        expect(wrong.body).toMatchObject({ ok: false, code: "UNAUTHORIZED", message: "Invalid Credentials" });

        mockGoogle({ sub: "google-sub-6", email: "ghost@test.com" });
        const ghost = await request(app)
            .post("/auth/google/link")
            .send({ idToken: "token", password: PASSWORD });
        expect(ghost.status).toBe(401);
        expect(ghost.body).toMatchObject({ ok: false, code: "UNAUTHORIZED", message: "Invalid Credentials" });
    });

    it("rejects unverified Google emails with 403", async () => {
        mockGoogle({ sub: "google-sub-7", email: "unverified@test.com", emailVerified: false });

        const res = await request(app).post("/auth/google").send({ idToken: "token" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
    });

    it("rejects invalid Google tokens with 401", async () => {
        mockGoogleFailure();

        const res = await request(app).post("/auth/google").send({ idToken: "bogus" });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
    });

    it("validates the request body with issues", async () => {
        mockGoogle({ sub: "google-sub-8", email: "x@test.com" });

        const res = await request(app).post("/auth/google").send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
        expect(Array.isArray(res.body.issues)).toBe(true);
    });
});
