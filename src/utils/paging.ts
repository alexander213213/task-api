/** Clamp page size to 1–100, defaulting to 20. */
export function clampLimit(raw: number | undefined): number {
    return Math.min(100, Math.max(1, raw ?? 20));
}

export interface Page<T> {
    page: T[];
    hasNextPage: boolean;
    nextCursor: string | null;
}

/**
 * Slice a take(limit+1) result set into a page. cursorOf(last) builds the
 * opaque cursor for the next request; return null cursor on the last page.
 */
export function paginate<T>(rows: T[], limit: number, cursorOf: (last: T) => string): Page<T> {
    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
        page,
        hasNextPage,
        nextCursor: hasNextPage && last !== undefined ? cursorOf(last) : null,
    };
}
