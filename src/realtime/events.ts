import { Router, Request, Response } from "express";
import { authorizeUser } from "../middlewares/authorize";
import { bus, TaskEvent } from "./bus";

const HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS ?? 20000);

const router = Router();

function canSee(event: TaskEvent, userId: string): boolean {
    return event.to.includes("*") || event.to.includes(userId);
}

function send(res: Response, event: TaskEvent): void {
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

/**
 * GET /events — SSE stream for task notifications + live feed.
 * Auth via cookie (EventSource must use withCredentials).
 * Resume with Last-Event-ID; server replays its recent buffer then live-tails.
 */
router.get("", authorizeUser, (req: Request, res: Response) => {
    const userId = res.locals.userId as string;

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    // Hello chunk: headers alone may sit buffered (proxies, TCP) until the
    // first body bytes move — flushing immediately is standard SSE practice.
    res.write(": connected\n\n");

    const rawLastId = req.headers["last-event-id"];
    const lastId = typeof rawLastId === "string" ? Number(rawLastId) : NaN;
    if (Number.isFinite(lastId)) {
        for (const event of bus.since(lastId)) {
            if (canSee(event, userId)) send(res, event);
        }
    }

    const onEvent = (event: TaskEvent) => {
        if (canSee(event, userId)) send(res, event);
    };
    const unsubscribe = bus.subscribe(onEvent);

    const heartbeat = setInterval(() => {
        res.write(": ping\n\n");
    }, HEARTBEAT_MS);

    const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
    };
    req.on("close", cleanup);
    res.on("error", cleanup);
});

export default router;
