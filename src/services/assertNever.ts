

export function assertNever(x: never): never {
    throw new Error("This case never throws")
}