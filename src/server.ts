import { errorHandler } from "./middlewares/error";
import express from "express";
import 'dotenv/config'
import authRouter from "./routes/auth"
import taskRouter from "./routes/task"
import cookieParser from "cookie-parser"
import cors from "cors"

const app = express()

const allowedOrigins = [
  "http://localhost:5173",              // local dev
  "https://your-frontend.vercel.app",   // production
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(express.json())
app.use(cookieParser())
app.use("/auth", authRouter)
app.use("/tasks", taskRouter)
app.use(errorHandler)

export default app