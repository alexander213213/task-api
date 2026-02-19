import { errorHandler } from "./middlewares/error";
import { prisma } from "./services/db";
import express, { Express, Request, Response } from "express";
import authRouter from "./routes/auth"
import cookieParser from "cookie-parser"

const app = express()

app.use(express.json())
app.use(errorHandler)
app.use(cookieParser())
app.use("/auth", authRouter)

export default app