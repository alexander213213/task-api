import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request, { agent } from "supertest"
import { resetDb } from "../helpers/db";
import { prisma } from "../../src/services/db"
import { hash } from "bcrypt";

describe("POST /auth/refresh", () => {
    beforeEach(async() => {
        await resetDb()
    })

    it("returns 401 if credentials are invalid", async () => {        
        const res = await request(app)
            .post("/auth/refresh")

        
        expect(res.status).toBe(401)
        expect(res.body.ok).toBe(false)
    })

    it("returns 401 if token  isn't valid", async () => {
        const res = await request.agent(app)
            .post("/auth/refresh")
            .set("Cookie", ["refresh_token=wrongToken"])
        
        expect(res.status).toBe(401)
        expect(res.body.ok).toBe(false)
    })

    it("returns 200 if proper cookies are sent", async () => {
        const passwordHash = await hash("myPassword", 10)
        const user = await prisma.user.create({
            data: {
                email: "alex@test.com",
                username: "testUser",
                firstName: "Alexander",
                lastName: "Gracilla",
                passwordHash
            }
        })

        const agent = request.agent(app)

        await agent
            .post("/auth/login")
            .send({
                username: user.username,
                password: "myPassword"
            })
        
        const res = await agent
            .post("/auth/refresh")

        expect(res.status).toBe(200)
        expect(res.body.ok).toBe(true)
    })
})