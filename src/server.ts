import { errorHandler } from "./middlewares/error";
import express from "express";
import 'dotenv/config'
import authRouter from "./routes/auth"
import taskRouter from "./routes/task"
import usersRouter from "./routes/users"
import eventsRouter from "./realtime/events"
import { openapiSpec } from "./openapi/spec"
import { apiReference } from "@scalar/express-api-reference"
import cookieParser from "cookie-parser"
import cors from "cors"
import helmet from "helmet"

const app = express()

// Helmet first. crossOriginResourcePolicy must stay cross-origin: the
// Vercel front opens credentialed EventSource/fetch to this API.
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
}))

const allowedOrigins = [
  "http://localhost:5173",              // local dev
  ...(process.env.FRONTEND_URL?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
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
app.use("/users", usersRouter)
app.use("/events", eventsRouter)
app.get("/openapi.json", (_req, res) => res.json(openapiSpec))
app.use("/openapi", apiReference({ content: openapiSpec }))
app.use(errorHandler)

export default app