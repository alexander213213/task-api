import { SECURED, errRef, okEnvelope, registry } from "../components";
import { z } from "zod";

export function registerEventPaths() {
    registry.registerPath({
        method: "get",
        path: "/health",
        description: "Liveness probe for orchestrators. 200 when the process and database answer.",
        responses: {
            200: {
                description: "Healthy",
                content: {
                    "application/json": {
                        schema: okEnvelope(z.object({}).strict(), "HealthOk"),
                    },
                },
            },
            503: errRef(503, "Database unreachable"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/events",
        ...SECURED,
        summary: "SSE stream for notifications and live feed",
        description:
            "text/event-stream. Event types: task:created (broadcast), proposal:created, task:assigned, task:unassigned, task:submitted, task:confirmed, review:received (each scoped to owner or tasker). Resume with Last-Event-ID; server replays its recent buffer. Send credentials (cookies) with the EventSource.",
        responses: {
            200: { description: "Infinite event stream" },
            401: errRef(401, "Not authenticated"),
        },
    });
}
