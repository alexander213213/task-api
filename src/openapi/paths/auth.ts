import { z } from "zod";
import {
    PUBLIC,
    SECURED,
    SafeUserSchema,
    errRef,
    okEnvelope,
    registry,
} from "../components";

const RegisterBody = z.object({
    username: z.string().openapi({ example: "gracilla_42" }),
    email: z.string().openapi({ example: "alex@test.com" }),
    firstName: z.string(),
    lastName: z.string(),
    middleName: z.string().optional(),
    password: z.string().min(8),
});

const LoginBody = z.union([
    z.object({ email: z.string(), password: z.string() }),
    z.object({ username: z.string(), password: z.string() }),
]);

const ExistsQuery = z.object({
    email: z.string().optional().openapi({ description: "Check by email" }),
    username: z.string().optional().openapi({ description: "Check by username (min 3 chars)" }),
});

const ExistsData = okEnvelope(z.object({ exists: z.boolean() }), "ExistsResult");
const UserData = okEnvelope(z.object({ user: SafeUserSchema }), "UserResult");
const EmptyOk = okEnvelope(z.null(), "EmptyOk");

export function registerAuthPaths() {
    registry.registerPath({
        method: "post",
        path: "/auth/register",
        ...PUBLIC,
        summary: "Register a password account",
        request: { body: { content: { "application/json": { schema: RegisterBody } } } },
        responses: {
            201: { description: "Created", content: { "application/json": { schema: EmptyOk } } },
            400: errRef(400, "Validation failed"),
            409: errRef(409, "Email or username taken"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/auth/login",
        ...PUBLIC,
        summary: "Log in with email or username + password",
        request: { body: { content: { "application/json": { schema: LoginBody } } } },
        responses: {
            200: {
                description: "Sets access_token + refresh_token cookies",
                content: { "application/json": { schema: UserData } },
            },
            400: errRef(400, "Validation failed"),
            401: errRef(401, "Invalid credentials"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/auth/refresh",
        ...PUBLIC,
        summary: "Rotate the refresh cookie into a fresh pair",
        responses: {
            200: { description: "New cookies set", content: { "application/json": { schema: EmptyOk } } },
            401: errRef(401, "Missing, expired, revoked, or reused token"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/auth/logout",
        ...SECURED,
        summary: "Log out this session",
        responses: {
            200: { description: "Cookies cleared", content: { "application/json": { schema: EmptyOk } } },
        },
    });

    registry.registerPath({
        method: "post",
        path: "/auth/logout-all",
        ...SECURED,
        summary: "Log out every session for this user",
        responses: {
            200: { description: "Cookies cleared", content: { "application/json": { schema: EmptyOk } } },
        },
    });

    registry.registerPath({
        method: "get",
        path: "/auth/me",
        ...SECURED,
        summary: "Current user profile",
        responses: {
            200: { description: "Profile", content: { "application/json": { schema: UserData } } },
            401: errRef(401, "Not authenticated"),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/auth/exist",
        ...PUBLIC,
        summary: "Check whether an email or username is taken",
        request: { query: ExistsQuery },
        responses: {
            200: { description: "Existence flag", content: { "application/json": { schema: ExistsData } } },
            400: errRef(400, "Provide email or username"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/auth/google",
        ...PUBLIC,
        summary: "Log in with a Google ID token (GIS)",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({ idToken: z.string().openapi({ description: "Google ID token" }) }),
                    },
                },
            },
        },
        responses: {
            200: { description: "Linked account login", content: { "application/json": { schema: UserData } } },
            201: { description: "New Google account created", content: { "application/json": { schema: UserData } } },
            401: errRef(401, "Invalid Google token"),
            403: errRef(403, "Unverified email or disallowed domain"),
            409: errRef(409, "GOOGLE_LINK_REQUIRED: password account owns this email"),
            500: errRef(500, "Google login not configured"),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/auth/google/link",
        ...PUBLIC,
        summary: "Link Google to an existing password account (password proof required)",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            idToken: z.string(),
                            password: z.string().openapi({ description: "Current account password" }),
                        }),
                    },
                },
            },
        },
        responses: {
            200: { description: "Linked, session issued", content: { "application/json": { schema: UserData } } },
            400: errRef(400, "Validation failed"),
            401: errRef(401, "Invalid token or credentials"),
            403: errRef(403, "Unverified email or disallowed domain"),
            409: errRef(409, "Already linked to a different Google account"),
        },
    });
}
