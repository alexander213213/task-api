/**
 * Fail-fast environment validation. Call once at process start (src/index.ts),
 * never from request handling. GOOGLE_CLIENT_ID is optional (Google login
 * returns an explicit 500 when unconfigured).
 */
const REQUIRED = ["DATABASE_URL", "ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"] as const;

export function assertEnv(): void {
    const missing = REQUIRED.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
        console.warn("GOOGLE_CLIENT_ID is not set — Google login will return 500 until configured.");
    }
}
