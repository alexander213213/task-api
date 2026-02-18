import { errorHandler } from "./middlewares/error";
import { prisma } from "./services/db";
import express, { Express, Request, Response } from "express";
import authRouter from "./routes/auth"

const app = express()

app.use(express.json())
app.use("/auth", authRouter)

export default app