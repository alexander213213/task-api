import app from "../../src/server";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest"
import { resetDb } from "../helpers/db";
import { prisma } from "../../src/services/db"
import { hash } from "bcrypt";
import { getCookie } from "../helpers/getCookie";

describe("POST /auth/logout", () => {
    beforeEach(async () => {
        await resetDb()
    })

    it("removes cookies at logout", async () => {
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

        const agent = request.agent(app)

        const login = await agent
            .post("/auth/login")
            .send({
                username: "testUser",
                password: "somePassword"
            })
        expect(login.status).toBe(200)
        expect(login.body.ok).toBe(true)
        const res = await agent
            .post("/auth/logout")
        
        const cookies = res.header["set-cookie"] as unknown as string[] | undefined
        
        const refreshToken = getCookie(cookies, "refresh_token")
        const accessToken = getCookie(cookies, "access_token")
        expect(refreshToken).toBeFalsy()
        expect(accessToken).toBeFalsy()
    })
})