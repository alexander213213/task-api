import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./components";
import { registerAuthPaths } from "./paths/auth";
import { registerTaskPaths } from "./paths/tasks";
import { registerUserPaths } from "./paths/users";
import { registerEventPaths } from "./paths/events";

registerAuthPaths();
registerTaskPaths();
registerUserPaths();
registerEventPaths();

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openapiSpec = generator.generateDocument({
    openapi: "3.0.0",
    info: {
        version: "1.0.0",
        title: "Task Marketplace API",
        description:
            "Post tasks, propose, assign, submit, confirm, and review. Auth is cookie-based (access_token); attach cookies in API clients. Responses use { ok, data, message?, code?, issues? }.",
    },
    servers: [{ url: "/" }],
});
