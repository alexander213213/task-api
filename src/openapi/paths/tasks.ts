import { z } from "zod";
import {
    ProposalSchema,
    ReviewSchema,
    SECURED,
    TaskIdParam,
    TaskSchema,
    errRef,
    okEnvelope,
    registry,
} from "../components";

const FeedQuery = z.object({
    cursor: z.string().optional().openapi({ description: "Opaque keyset cursor from a previous page" }),
    limit: z.coerce.number().optional().openapi({ description: "Page size, 1-100, default 20" }),
    sort_by: z.enum(["newest", "reward_desc", "deadline_soon"]).optional().openapi({ description: "Default newest" }),
    q: z.string().optional().openapi({ description: "Case-insensitive match on title/description" }),
    minReward: z.coerce.number().optional(),
    maxReward: z.coerce.number().optional(),
    deadlineFrom: z.string().optional().openapi({ description: "ISO datetime" }),
    deadlineTo: z.string().optional().openapi({ description: "ISO datetime" }),
});

const MyTasksQuery = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
    status: z.enum(["OPEN", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCELLED"]).optional(),
});

const FeedPage = okEnvelope(
    z.object({
        tasks: z.array(TaskSchema),
        nextCursor: z.string().nullable(),
        hasNextPage: z.boolean(),
    }),
    "FeedPage"
);

const TaskResult = okEnvelope(z.object({ task: TaskSchema }), "TaskResult");

const CreateTaskBody = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    reward: z.number().openapi({ example: 150 }),
    deadline: z.string().openapi({ example: "2026-12-01T00:00:00.000Z", description: "Future ISO datetime" }),
});

const PatchBody = z.union([
    z.object({
        op: z.literal("replace"),
        path: z.enum(["/title", "/deadline", "/description", "/reward"]),
        value: z.unknown(),
    }),
    z.object({ op: z.literal("remove"), path: z.literal("/description") }),
]);

const ProposalBody = z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(0).max(2000),
});

const ProposalsResult = okEnvelope(z.object({ proposals: z.array(ProposalSchema) }), "ProposalsResult");
const ProposalResult = okEnvelope(z.object({ proposal: ProposalSchema }), "ProposalResult");

const AssignBody = z.object({ userId: z.string() });
const ReviewBody = z.object({
    stars: z.number().int().min(1).max(5),
    comment: z.string().min(1).max(1000),
});
const ReviewResult = okEnvelope(z.object({ review: ReviewSchema.nullable() }), "ReviewResult");

const StatusTask = okEnvelope(
    z.object({ task: TaskSchema.pick({ id: true, status: true }) }),
    "StatusTask"
);

export function registerTaskPaths() {
    registry.registerPath({
        method: "post",
        path: "/tasks",
        ...SECURED,
        summary: "Post a task",
        request: { body: { content: { "application/json": { schema: CreateTaskBody } } } },
        responses: {
            201: { description: "Created", content: { "application/json": { schema: TaskResult } } },
            400: errRef(400, "Validation failed"),
            401: errRef(401, "Not authenticated"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/tasks",
        ...SECURED,
        summary: "Open-task feed (keyset paginated, excludes your own)",
        request: { query: FeedQuery },
        responses: {
            200: { description: "Page", content: { "application/json": { schema: FeedPage } } },
            400: errRef(400, "Bad query or cursor"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/tasks/me",
        ...SECURED,
        summary: "Tasks you posted (paginated, optional status filter)",
        request: { query: MyTasksQuery },
        responses: {
            200: { description: "Page", content: { "application/json": { schema: FeedPage } } },
            400: errRef(400, "Bad query or cursor"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/tasks/assigned/me",
        ...SECURED,
        summary: "Tasks assigned to you (paginated, optional status filter)",
        request: { query: MyTasksQuery },
        responses: {
            200: { description: "Page", content: { "application/json": { schema: FeedPage } } },
            400: errRef(400, "Bad query or cursor"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/tasks/{taskId}",
        ...SECURED,
        summary: "Task detail with owner, tasker, review, counts, and your proposal",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Detail", content: { "application/json": { schema: TaskResult } } },
            404: errRef(404, "Task not found"),
        },
    });

    registry.registerPath({
        method: "patch",
        path: "/tasks/{taskId}",
        ...SECURED,
        summary: "Edit an OPEN task you own (JSON-patch style, single op)",
        request: {
            params: TaskIdParam,
            body: { content: { "application/json": { schema: PatchBody } } },
        },
        responses: {
            200: { description: "Updated", content: { "application/json": { schema: TaskResult } } },
            400: errRef(400, "Validation failed"),
            403: errRef(403, "Not the owner"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Task is no longer open"),
        },
    });

    registry.registerPath({
        method: "delete",
        path: "/tasks/{taskId}",
        ...SECURED,
        summary: "Delete a task you own (OPEN or CANCELLED only)",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Deleted", content: { "application/json": { schema: TaskResult } } },
            403: errRef(403, "Not the owner"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Only open or cancelled tasks can be deleted"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/tasks/{taskId}/proposals",
        ...SECURED,
        summary: "Propose on an OPEN task (one per user)",
        request: {
            params: TaskIdParam,
            body: { content: { "application/json": { schema: ProposalBody } } },
        },
        responses: {
            201: { description: "Created", content: { "application/json": { schema: ProposalResult } } },
            400: errRef(400, "Validation failed"),
            403: errRef(403, "Owner cannot propose"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Not open or already proposed"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/tasks/{taskId}/proposals",
        ...SECURED,
        summary: "List proposals (owner only, with proposer ratings)",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Proposals", content: { "application/json": { schema: ProposalsResult } } },
            403: errRef(403, "Not the owner"),
            404: errRef(404, "Task not found"),
        },
    });

    registry.registerPath({
        method: "patch",
        path: "/tasks/{taskId}/proposals/me",
        ...SECURED,
        summary: "Edit your proposal while the task is open",
        request: {
            params: TaskIdParam,
            body: { content: { "application/json": { schema: ProposalBody } } },
        },
        responses: {
            200: { description: "Updated", content: { "application/json": { schema: ProposalResult } } },
            404: errRef(404, "Proposal not found"),
            409: errRef(409, "Task is no longer open"),
        },
    });

    registry.registerPath({
        method: "delete",
        path: "/tasks/{taskId}/proposals/me",
        ...SECURED,
        summary: "Withdraw your proposal while the task is open",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Withdrawn", content: { "application/json": { schema: okEnvelope(z.object({ taskId: z.string() }), "WithdrawResult") } } },
            404: errRef(404, "Proposal not found"),
            409: errRef(409, "Task is no longer open"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/tasks/{taskId}/assign",
        ...SECURED,
        summary: "Assign a proposer (owner only, task must be OPEN)",
        request: {
            params: TaskIdParam,
            body: { content: { "application/json": { schema: AssignBody } } },
        },
        responses: {
            200: { description: "Assigned", content: { "application/json": { schema: StatusTask } } },
            400: errRef(400, "Validation failed or self-assign"),
            403: errRef(403, "Not the owner, or user never proposed"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Task is not assignable"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/tasks/{taskId}/submit",
        ...SECURED,
        summary: "Submit completed work (tasker only, ASSIGNED only)",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Submitted", content: { "application/json": { schema: StatusTask } } },
            403: errRef(403, "Not the tasker"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Task is not ASSIGNED"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/tasks/{taskId}/confirm",
        ...SECURED,
        summary: "Confirm completion (owner only, SUBMITTED only)",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Completed", content: { "application/json": { schema: StatusTask } } },
            403: errRef(403, "Not the owner"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Task is not SUBMITTED"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/tasks/{taskId}/review",
        ...SECURED,
        summary: "Review the tasker (owner only, COMPLETED only, once)",
        request: {
            params: TaskIdParam,
            body: { content: { "application/json": { schema: ReviewBody } } },
        },
        responses: {
            201: { description: "Reviewed; tasker rating updated atomically", content: { "application/json": { schema: ReviewResult } } },
            400: errRef(400, "Validation failed"),
            403: errRef(403, "Not reviewable by you"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Review already exists"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/tasks/{taskId}/review",
        ...SECURED,
        summary: "Read a task's review (null when none)",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Review or null", content: { "application/json": { schema: ReviewResult } } },
            404: errRef(404, "Task not found"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/tasks/{taskId}/cancel",
        ...SECURED,
        summary: "Cancel an OPEN task you own",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Cancelled", content: { "application/json": { schema: StatusTask } } },
            403: errRef(403, "Not the owner"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Task is not open"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/tasks/{taskId}/unassign",
        ...SECURED,
        summary: "Send an ASSIGNED/SUBMITTED task back to OPEN (owner only)",
        request: { params: TaskIdParam },
        responses: {
            200: { description: "Unassigned", content: { "application/json": { schema: StatusTask } } },
            403: errRef(403, "Not the owner"),
            404: errRef(404, "Task not found"),
            409: errRef(409, "Task is not assigned"),
        },
    });
}
