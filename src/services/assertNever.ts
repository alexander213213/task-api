

export function assertNever(x: never) {
    throw new Error("This case never throws")
}