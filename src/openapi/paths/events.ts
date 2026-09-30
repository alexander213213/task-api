import { SECURED, errRef, registry } from "../components";

export function registerEventPaths() {
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
