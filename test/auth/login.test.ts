import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest"
import { resetDb } from "../helpers/db";
import { prisma } from "../../src/services/db"
import { hash } from "bcrypt";


describe("POST /auth/login", () => {
    beforeEach(async () => {
        await resetDb()
    })


    it("returns 400 if payload is invalid", async () => {
        const payload = {
            username: "alex"
        }
        const res = await request(app)
            .post("/auth/login")
            .send(payload)

        expect(res.status).toBe(400)
        expect(res.ok).toBe(false)
    })

    it("returns 401 if credentials are invalid", async () => {

        const passwordHash = await hash("somePassword", 10)
        const user = await prisma.user.create({
            data: {
                email: "test@user.com",
                username: "testUser",
                firstName: "alex",
                lastName: "gracilla",
                passwordHash
            }
        })

        const res = await request(app)
            .post("/auth/login")
            .send({
                username: "test",
                password: "somePassword"
            })

        expect(res.status).toBe(401)
        expect(res.body.ok).toBe(false)
    })

    it("returns 200 if successful", async () => {
        const passwordHash = await hash("somePassword", 10)
        const user = await prisma.user.create({
            data: {
                email: "test@user.com",
                username: "testUser",
                firstName: "alex",
                lastName: "gracilla",
                passwordHash
            }
        })

        const res = await request(app)
            .post("/auth/login")
            .send({
                email: "test@user.com",
                password: "somePassword"
            })

        expect(res.status).toBe(200)
        expect(res.body.ok).toBe(true)
    })
})