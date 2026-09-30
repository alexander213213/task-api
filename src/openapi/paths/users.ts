import { z } from "zod";
import {
    SECURED,
    SafeUserSchema,
    UserIdParam,
    errRef,
    okEnvelope,
    registry,
} from "../components";

const StatsData = okEnvelope(
    z.object({
        user: SafeUserSchema,
        posted: z.number().int(),
        active: z.number().int().openapi({ description: "ASSIGNED + SUBMITTED as tasker" }),
        completedAsTasker: z.number().int(),
        proposalsSent: z.number().int(),
    }),
    "StatsResult"
);

const PublicProfile = okEnvelope(
    z.object({
        user: SafeUserSchema.extend({
            posted: z.number().int(),
            completedAsTasker: z.number().int(),
        }),
    }),
    "PublicProfile"
);

export function registerUserPaths() {
    registry.registerPath({
        method: "get",
        path: "/users/me/stats",
        ...SECURED,
        summary: "Your task counts, proposals, and rating",
        responses: {
            200: { description: "Stats", content: { "application/json": { schema: StatsData } } },
            401: errRef(401, "Not authenticated"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/users/{id}/public",
        ...SECURED,
        summary: "Public profile with task counts",
        request: { params: UserIdParam },
        responses: {
            200: { description: "Profile", content: { "application/json": { schema: PublicProfile } } },
            404: errRef(404, "User not found"),
        },
    });
}
