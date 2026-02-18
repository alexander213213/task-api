import { prisma } from "./db";
import express, { Express, Request, Response } from "express";

const app = express()

app.use(express.json())




export default app