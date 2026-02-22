import { errorHandler } from "./middlewares/error";
import express from "express";
import 'dotenv/config'
import authRouter from "./routes/auth"
import cookieParser from "cookie-parser"

const app = express()

app.use(express.json())
app.use(cookieParser())
app.use("/auth", authRouter)
app.use(errorHandler)

export default app