import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "access_token",
    description: "Session cookie set by login/refresh. Browsers send it automatically; Scalar/API clients must attach it.",
});

const authed: [{ cookieAuth: [] }] = [{ cookieAuth: [] }];
export const SECURED = { security: authed } as const;
export const PUBLIC = { security: [] as never[] } as const;

export const ErrorSchema = z
    .object({
        ok: z.literal(false),
        code: z.string().openapi({
            example: "VALIDATION_ERROR",
            description:
                "Machine code: VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT_STATE, ALREADY_EXISTS, GOOGLE_LINK_REQUIRED, EMAIL_NOT_VERIFIED, RATE_LIMITED, SERVER_ERROR",
        }),
        message: z.string(),
        issues: z.array(z.any()).optional().openapi({ description: "Zod issues on 400s" }),
    })
    .openapi("");

export function okEnvelope<T extends z.ZodTypeAny>(data: T, refId: string) {
    return z
        .object({
            ok: z.literal(true),
            data,
            message: z.string().optional(),
        })
        .openapi(refId);
}

const username = z.string().openapi({ example: "gracilla_42" });
const ratingAvg = z.number().openapi({ example: 4.5 });
const ratingCount = z.number().int().openapi({ example: 12 });

export const OwnerSchema = z
    .object({ username, ratingAvg, ratingCount })
    .openapi("");

export const SafeUserSchema = z
    .object({
        id: z.string(),
        username,
        email: z.string().openapi({ example: "alex@test.com" }),
        firstName: z.string(),
        lastName: z.string(),
        middleName: z.string().nullable(),
        ratingAvg,
        ratingCount,
    })
    .openapi("");

/** Prisma Decimal serializes as a string in JSON responses. */
export const rewardJson = z.string().openapi({ example: "250", description: "Decimal reward, JSON-serialized as string" });
const isoDate = z.string().openapi({ example: "2026-10-01T00:00:00.000Z", description: "ISO datetime string" });

export const TaskSchema = z
    .object({
        id: z.string(),
        title: z.string(),
        description: z.string().nullable(),
        reward: rewardJson,
        createdAt: isoDate,
        deadline: isoDate,
        updatedAt: isoDate,
        ownerId: z.string(),
        status: z.enum(["OPEN", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCELLED"]),
        owner: z.object({ username }).optional(),
        tasker: z.object({ username }).nullable().optional(),
    })
    .openapi("");

export const ProposalSchema = z
    .object({
        taskId: z.string(),
        userId: z.string(),
        title: z.string(),
        body: z.string(),
        createdAt: isoDate,
        updatedAt: isoDate,
        user: z.object({ username, ratingAvg, ratingCount }).optional(),
    })
    .openapi("");

export const ReviewSchema = z
    .object({
        id: z.string(),
        stars: z.number().int().min(1).max(5),
        comment: z.string(),
        createdAt: isoDate,
        reviewerId: z.string(),
        revieweeId: z.string(),
    })
    .openapi("");

export const TaskIdParam = z.object({ taskId: z.string().openapi({ description: "Task cuid" }) });
export const UserIdParam = z.object({ id: z.string().openapi({ description: "User cuid" }) });

export function errRef(status: number, description: string) {
    return {
        description,
        content: { "application/json": { schema: ErrorSchema } },
    };
}
