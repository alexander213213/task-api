import { OAuth2Client } from "google-auth-library";

export interface GoogleProfile {
    sub: string;
    email: string;
    emailVerified: boolean;
    givenName?: string;
    familyName?: string;
}

export class GoogleNotConfiguredError extends Error {}
export class GoogleTokenError extends Error {}

/** Test seam: bypasses network verification when set. Always reset after use. */
let verifyOverride: ((idToken: string) => Promise<GoogleProfile>) | null = null;

export function __setGoogleVerifier(fn: ((idToken: string) => Promise<GoogleProfile>) | null): void {
    verifyOverride = fn;
}

let cachedClient: OAuth2Client | null = null;

export async function verifyGoogleToken(idToken: string): Promise<GoogleProfile> {
    if (verifyOverride) return verifyOverride(idToken);

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        throw new GoogleNotConfiguredError("GOOGLE_CLIENT_ID is not configured");
    }

    if (!cachedClient) cachedClient = new OAuth2Client(clientId);

    let payload;
    try {
        const ticket = await cachedClient.verifyIdToken({ idToken, audience: clientId });
        payload = ticket.getPayload();
    } catch {
        throw new GoogleTokenError("Invalid Google token");
    }

    if (!payload?.sub || !payload?.email) {
        throw new GoogleTokenError("Invalid Google token");
    }

    const profile: GoogleProfile = {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified ?? false,
    };
    if (payload.given_name) profile.givenName = payload.given_name;
    if (payload.family_name) profile.familyName = payload.family_name;
    return profile;
}

/** Optional allowlist via GOOGLE_ALLOWED_DOMAINS=example.com,other.org. Unset = allow all. */
export function isEmailDomainAllowed(email: string): boolean {
    const raw = process.env.GOOGLE_ALLOWED_DOMAINS;
    if (!raw) return true;
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    return raw
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0)
        .includes(domain);
}
