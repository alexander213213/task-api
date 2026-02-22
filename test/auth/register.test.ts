import app from "../../src/server"
import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import { resetDb } from "../helpers/db"
import { prisma } from "../../src/services/db"

describe("POST /auth/register", () => {
    beforeEach(async () => {
        await resetDb()
    })

    it("returns 400 if payload is invalid", async () => {
        const res = await request(app)
            .post("/auth/register")
            .send({ username: "alex" })

        expect(res.status).toBe(400)
        expect(res.body.ok).toBe(false)
    })

    it("returns 201 when payload is valid", async () => {
        const payload = {
            email: "alex@test.com",
            username: "testUser",
            firstName: "Alexander",
            lastName: "Gracilla",
            password: "123456788"
        }
        const res = await request(app)
            .post("/auth/register")
            .send(payload)

        expect(res.status).toBe(201)
        expect(res.body.ok).toBe(true)
        const user = await prisma.user.findUnique({
            where: { username: "testUser" }
        })
        expect(user).not.toBeNull()
        expect(user?.passwordHash).not.toBe(payload.password)
        expect(typeof user?.passwordHash).toBe("string")
        expect(user?.passwordHash.length).toBeGreaterThan(10)
    })

    it("returns 409 when user already exist", async () => {
        const user = await prisma.user.create({
            data: {
                email: "alex@test.com",
                username: "testUser",
                firstName: "Alexander",
                lastName: "Gracilla",
                passwordHash: "someHash1021301203012"
            }
        })

        expect(user.id).not.toBeNull()

        const res = await request(app)
            .post("/auth/register")
            .send({
                email: "alex@test.com",
                username: "testUser",
                firstName: "Alexander",
                lastName: "Gracilla",
                password: "123456788"
            })

        expect(res.status).toBe(409)
        expect(res.body.ok).toBe(false)
    })
})