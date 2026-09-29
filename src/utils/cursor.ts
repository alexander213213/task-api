import { Prisma } from "../../generated/prisma/client";

export type TaskSort = "newest" | "reward_desc" | "deadline_soon";

interface CursorPayload {
    v: 1;
    sort_by: TaskSort;
    sortValue: string;
    id: string;
}

const SORTS: TaskSort[] = ["newest", "reward_desc", "deadline_soon"];

/** Opaque keyset cursor: base64url(JSON({ v, sort_by, sortValue, id })). */
export function encodeCursor(sort_by: TaskSort, sortValue: string, id: string): string {
    return Buffer.from(JSON.stringify({ v: 1, sort_by, sortValue, id })).toString("base64url");
}

/** Returns null for any malformed/foreign cursor (never throws). */
export function decodeCursor(raw: unknown): CursorPayload | null {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) return null;
    try {
        const p: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        if (typeof p !== "object" || p === null) return null;
        const c = p as Record<string, unknown>;
        if (c["v"] !== 1) return null;
        if (typeof c["sort_by"] !== "string" || !SORTS.includes(c["sort_by"] as TaskSort)) return null;
        if (typeof c["sortValue"] !== "string" || c["sortValue"].length === 0) return null;
        if (typeof c["id"] !== "string" || c["id"].length === 0) return null;
        return { v: 1, sort_by: c["sort_by"] as TaskSort, sortValue: c["sortValue"] as string, id: c["id"] as string };
    } catch {
        return null;
    }
}

/**
 * Keyset WHERE matching the route's ORDER BY for each sort.
 * Throws on unparseable sortValue (caller maps to 400).
 */
export function keysetWhere(cursor: CursorPayload): Prisma.TaskWhereInput {
    switch (cursor.sort_by) {
        case "newest": {
            const sv = new Date(cursor.sortValue);
            if (Number.isNaN(sv.getTime())) throw new Error("Invalid cursor sortValue");
            // order: createdAt DESC, id DESC
            return { OR: [{ createdAt: { lt: sv } }, { createdAt: sv, id: { lt: cursor.id } }] };
        }
        case "reward_desc": {
            let sv: Prisma.Decimal;
            try {
                sv = new Prisma.Decimal(cursor.sortValue);
            } catch {
                throw new Error("Invalid cursor sortValue");
            }
            // order: reward DESC, id DESC
            return { OR: [{ reward: { lt: sv } }, { reward: sv, id: { lt: cursor.id } }] };
        }
        case "deadline_soon": {
            const sv = new Date(cursor.sortValue);
            if (Number.isNaN(sv.getTime())) throw new Error("Invalid cursor sortValue");
            // order: deadline ASC, id ASC
            return { OR: [{ deadline: { gt: sv } }, { deadline: sv, id: { gt: cursor.id } }] };
        }
    }
}

/** Extract the cursor sort value from a task row for the given sort. */
export function sortValueFor(
    sort_by: TaskSort,
    task: { createdAt: Date; reward: { toString(): string }; deadline: Date }
): string {
    switch (sort_by) {
        case "newest":
            return new Date(task.createdAt).toISOString();
        case "reward_desc":
            return task.reward.toString();
        case "deadline_soon":
            return new Date(task.deadline).toISOString();
    }
}
