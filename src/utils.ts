// Context from the sign-in form, encrypted and stored inside the MCP token
// grant, provided to the agent as this.props.
export type Props = {
	baseUrl: string;
	apiKey: string;
	userId: number;
	username: string;
	email: string;
	version: string;
};

// Which Wallos instances a connection may bind to. Patterns, comma-separated:
//   wallos.example.com   a single host
//   *.example.com        any host under that domain
//   *                    any host
// An empty setting admits no one. The check is on the hostname only, so a port
// or path prefix does not widen or narrow the match.
export function isHostAllowed(hostname: string, allowList: string | undefined): boolean {
	const host = hostname.trim().toLowerCase();
	if (!host) return false;
	const patterns = (allowList ?? "")
		.split(",")
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean);
	return patterns.some((p) => {
		if (p === "*") return true;
		if (p.startsWith("*.")) {
			const suffix = p.slice(1);
			return host.endsWith(suffix) && host.length > suffix.length;
		}
		return p === host;
	});
}

const PRIVATE_V4 =
	/^(?:0|10|127)\.|^169\.254\.|^172\.(?:1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
const PRIVATE_SUFFIX = /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/;

// Whatever a sign-in names, the Worker fetches, so an allowlist of a whole
// domain or `*` would otherwise aim requests at whatever the Worker can reach —
// a cloud metadata service at 169.254.169.254, a host on the operator's
// network. The compatibility flag global_fetch_strictly_public stops those at
// the platform; this check is the readable half, and it is lexical, so a public
// name that resolves to a private address is caught by the flag rather than
// here. An instance on a home network belongs behind a tunnel with a public
// hostname.
export function isPrivateHost(hostname: string): boolean {
	const host = hostname
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");
	if (!host) return true;
	if (PRIVATE_SUFFIX.test(host)) return true;
	// An IPv4 address written inside IPv6 carries the same reach as the bare one.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
	const v4 = mapped?.[1] ?? host;
	if (PRIVATE_V4.test(v4)) return true;
	if (host === "::" || host === "::1") return true;
	// Unique-local fc00::/7 and link-local fe80::/10.
	return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

// A deployment that admits a whole domain, or anyone, should still not admit
// an unbounded number of accounts: every grant consumes the deployment's own
// quota afterwards. Accounts already admitted keep working once the cap is
// reached; only new ones stop.
export function isUnderAccountCap(knownAccounts: number, isNewAccount: boolean, cap: number) {
	if (!isNewAccount) return true;
	if (!Number.isFinite(cap) || cap <= 0) return false;
	return knownAccounts < cap;
}

export function parseLimit(raw: string | undefined, fallback: number): number {
	const n = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

// The account a grant is keyed by: one Wallos user on one installation. Two
// installations can share a hostname behind different ports or path prefixes,
// and each keeps its own user table, so user 1 of one is not user 1 of the
// other. The allowlist stays hostname-only; identity is the whole address.
export function accountId(baseUrl: string, userId: number): string {
	const url = new URL(baseUrl);
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.protocol}//${url.host.toLowerCase()}${path}:${userId}`;
}

export function accountIdFromProps(props: Props): string {
	return accountId(props.baseUrl, props.userId);
}

export function hostnameOf(baseUrl: string): string {
	return new URL(baseUrl).hostname.toLowerCase();
}

// Origin + optional path prefix, no trailing slash. Credentials in the URL
// would travel in logs the same way a query-string API key would.
export function normalizeBaseUrl(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new Error("Wallos URL is required");
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error("Wallos URL must be an absolute https address");
	}
	// The API key travels in every request body, so plaintext transport hands it
	// to anything on the path. Wallos behind a reverse proxy that terminates TLS
	// is still reached over https from here.
	if (url.protocol !== "https:") {
		throw new Error("Wallos URL must use https");
	}
	if (url.username || url.password) {
		throw new Error("Wallos URL must not include credentials");
	}
	// A trailing dot is the same name to DNS and a different string to an
	// allowlist, so it is removed before either check sees the host.
	url.hostname = url.hostname.replace(/\.+$/, "");
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path === "/" ? "" : path}`;
}

export function redactSecret(text: string, secret: string): string {
	if (!secret) return text;
	return text.split(secret).join("[redacted]");
}

const SECRET_FIELD =
	/^(api_key|password|smtp_password|client_secret|token|bot_token|sendkey|user_key|headers|fixer_api_key)$|webhook/i;

// Wallos sometimes returns the real value for a setting that is a secret.
// Those fields belong in the instance, not in a tool result. A webhook URL is
// one of them: anything holding a Discord or ntfy webhook can post as the
// instance, so the address is the credential.
export function redactSecrets(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactSecrets);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			out[key] = SECRET_FIELD.test(key) ? "********" : redactSecrets(child);
		}
		return out;
	}
	return value;
}

// A sender that declares no length would otherwise decide how much memory a
// request occupies, so the body is counted as it arrives and refused part-way.
export class BodyTooLarge extends Error {}

// What an error response is worth reading. The peer decides how much it sends,
// and a diagnostic that has to be held whole before it can be trimmed is one
// the sender chose the size of.
export const MAX_ERROR_BYTES = 4_000;

// A successful Wallos listing can be larger than an error page; this is still
// a ceiling, because the reply is read into an assistant's context.
export const MAX_RESPONSE_BYTES = 400_000;

export async function readBoundedText(
	body: ReadableStream<Uint8Array> | null,
	limit = MAX_ERROR_BYTES,
): Promise<string> {
	const reader = body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.byteLength;
		if (total >= limit) {
			await reader.cancel();
			break;
		}
	}
	const joined = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		joined.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(joined.subarray(0, limit));
}

export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel();
			throw new BodyTooLarge();
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		body.set(chunk, at);
		at += chunk.byteLength;
	}
	return body;
}

// Wallos 5.0.0 is the release that introduced the API-key HTTP API this server
// is built on: every endpoint it calls exists from there, bar the two budget
// ones below. Older instances expose no write API at all, so a sign-in against
// one would bind a grant whose every tool fails.
export const MIN_WALLOS: [number, number, number] = [5, 0, 0];

// first version that ships api/subscriptions/get_period_budget.php
export const PERIOD_BUDGET_SINCE: [number, number, number] = [5, 3, 0];

export function parseVersion(raw: string): [number, number, number] | null {
	const match = raw
		.trim()
		.replace(/^v/i, "")
		.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function versionAtLeast(raw: string, min: [number, number, number]): boolean {
	const version = parseVersion(raw);
	if (!version) return false;
	for (let i = 0; i < 3; i++) {
		const a = version[i] ?? 0;
		const b = min[i] ?? 0;
		if (a > b) return true;
		if (a < b) return false;
	}
	return true;
}

export function hasPeriodBudget(version: string): boolean {
	return versionAtLeast(version, PERIOD_BUDGET_SINCE);
}

// An instance that reports no version at all is let through: api/status/version.php
// exists from 5.0.0 too, so a missing answer is more likely a proxy in the way
// than a genuinely ancient Wallos, and get_user.php has already succeeded by then.
export function meetsMinimum(version: string): boolean {
	if (parseVersion(version) === null) return true;
	return versionAtLeast(version, MIN_WALLOS);
}
