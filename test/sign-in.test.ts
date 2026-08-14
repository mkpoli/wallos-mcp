import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "./runtime-shim";

const { WallosHandler } = await import("../src/wallos-handler");
const { bindStateToSession, createOAuthState, generateCSRFProtection } = await import(
	"../src/workers-oauth-utils"
);

const realFetch = globalThis.fetch;

function memoryKv() {
	const store = new Map<string, string>();
	return {
		store,
		get: async (key: string) => store.get(key) ?? null,
		put: async (key: string, value: string) => {
			store.set(key, value);
		},
		delete: async (key: string) => {
			store.delete(key);
		},
		list: async (opts?: { prefix?: string; limit?: number }) => {
			const keys = [...store.keys()]
				.filter((name) => name.startsWith(opts?.prefix ?? ""))
				.map((name) => ({ name }));
			return { keys, list_complete: true };
		},
	};
}

const authRequest = {
	clientId: "client-1",
	redirectUri: "https://client.example/cb",
	scope: [],
	state: "s",
	responseType: "code",
	codeChallenge: "c",
	codeChallengeMethod: "S256",
};

function cookieValue(setCookie: string): string {
	return (setCookie.split(";")[0] ?? "").trim();
}

async function issued(kv: ReturnType<typeof memoryKv>) {
	const { stateToken } = await createOAuthState(authRequest as never, kv as never);
	const { setCookie } = await bindStateToSession(stateToken);
	const { token: csrfToken, setCookie: csrfCookie } = generateCSRFProtection();
	return {
		stateToken,
		cookie: `${cookieValue(setCookie)}; ${cookieValue(csrfCookie)}`,
		csrfToken,
	};
}

function envFor(
	kv: ReturnType<typeof memoryKv>,
	allowed: string,
	completed: PropsCapture[],
	maxAccounts = "25",
) {
	return {
		ALLOWED_HOSTS: allowed,
		MAX_ACCOUNTS: maxAccounts,
		COOKIE_ENCRYPTION_KEY: "cookie-secret",
		OAUTH_KV: kv,
		OAUTH_PROVIDER: {
			completeAuthorization: async ({ props }: { props: { baseUrl: string; userId: number } }) => {
				completed.push(props);
				return { redirectTo: "https://client.example/cb?code=granted" };
			},
		},
	};
}

type PropsCapture = {
	baseUrl: string;
	userId: number;
	apiKey?: string;
	username?: string;
	email?: string;
	version?: string;
};

function serveWallos(user: Record<string, unknown> | "html" | "fail") {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		if (user === "html") {
			return new Response("<html>login</html>", {
				status: 200,
				headers: { "Content-Type": "text/html" },
			});
		}
		if (user === "fail") {
			return Response.json({ success: false, title: "Unauthorized", message: "Invalid API key." });
		}
		if (url.includes("get_user.php")) {
			return Response.json({ success: true, user });
		}
		if (url.includes("version.php")) {
			return Response.json({ success: true, version: "v5.4.2", version_number: "5.4.2" });
		}
		return new Response("no route", { status: 404 });
	}) as unknown as typeof fetch;
}

async function postSignIn(
	kv: ReturnType<typeof memoryKv>,
	env: ReturnType<typeof envFor>,
	fields: Record<string, string>,
) {
	const issuedState = await issued(kv);
	const body = new URLSearchParams({
		csrf_token: issuedState.csrfToken,
		oauth_state: issuedState.stateToken,
		...fields,
	});
	return WallosHandler.fetch(
		new Request("https://server.example/sign-in", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Cookie: issuedState.cookie,
			},
			body: body.toString(),
		}),
		env as never,
		{} as never,
	);
}

beforeEach(() => {
	globalThis.fetch = realFetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("who the sign-in admits", () => {
	test("turns away a host outside the allowlist", async () => {
		const kv = memoryKv();
		const completed: PropsCapture[] = [];
		serveWallos({ id: 1, username: "jane", email: "jane@example.com" });
		const response = await postSignIn(kv, envFor(kv, "wallos.example.com", completed), {
			base_url: "https://other.example.com",
			api_key: "k",
		});
		expect(response.status).toBe(403);
		expect(await response.text()).toMatch(/not allowed/);
		expect(completed).toEqual([]);
	});

	test("admits a host on the allowlist and stores the grant", async () => {
		const kv = memoryKv();
		const completed: PropsCapture[] = [];
		serveWallos({ id: 7, username: "jane", email: "jane@example.com" });
		const response = await postSignIn(kv, envFor(kv, "wallos.example.com", completed), {
			base_url: "https://wallos.example.com/",
			api_key: "k",
		});
		expect(response.status).toBe(302);
		expect(completed).toEqual([
			{
				baseUrl: "https://wallos.example.com",
				userId: 7,
				apiKey: "k",
				username: "jane",
				email: "jane@example.com",
				version: "v5.4.2",
			},
		]);
		expect(await kv.get("account:https://wallos.example.com:7")).not.toBeNull();
	});

	test("turns away a URL that is not Wallos", async () => {
		const kv = memoryKv();
		const completed: PropsCapture[] = [];
		serveWallos("html");
		const response = await postSignIn(kv, envFor(kv, "*", completed), {
			base_url: "https://example.com",
			api_key: "k",
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toMatch(/Not a Wallos|did not return JSON/i);
		expect(completed).toEqual([]);
	});

	test("turns away a failed API key without echoing it", async () => {
		const kv = memoryKv();
		const completed: PropsCapture[] = [];
		serveWallos("fail");
		const response = await postSignIn(kv, envFor(kv, "*", completed), {
			base_url: "https://wallos.example.com",
			api_key: "super-secret-key",
		});
		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).toMatch(/Unauthorized|Invalid API key/);
		expect(text).not.toContain("super-secret-key");
		expect(completed).toEqual([]);
	});

	test("refuses a new account once the cap is reached", async () => {
		const kv = memoryKv();
		await kv.put("account:https://other.example.com:1", "already");
		const completed: PropsCapture[] = [];
		serveWallos({ id: 2, username: "new", email: "new@example.com" });
		const response = await postSignIn(kv, envFor(kv, "*", completed, "1"), {
			base_url: "https://wallos.example.com",
			api_key: "k",
		});
		expect(response.status).toBe(429);
		expect(completed).toEqual([]);
	});

	test("lets a known account back in at the cap", async () => {
		const kv = memoryKv();
		await kv.put("account:https://wallos.example.com:2", "already");
		const completed: PropsCapture[] = [];
		serveWallos({ id: 2, username: "jane", email: "jane@example.com" });
		const response = await postSignIn(kv, envFor(kv, "*", completed, "1"), {
			base_url: "https://wallos.example.com",
			api_key: "k",
		});
		expect(response.status).toBe(302);
		expect(completed).toHaveLength(1);
	});
});

describe("the cookies the approval sets", () => {
	test("sends each of them as its own header", async () => {
		const kv = memoryKv();
		const env = {
			...envFor(kv, "*", []),
			OAUTH_PROVIDER: {
				parseAuthRequest: async () => authRequest,
				lookupClient: async () => ({ clientId: "client-1", clientName: "Test Client" }),
			},
		};

		const dialog = await WallosHandler.fetch(
			new Request("https://server.example/authorize?client_id=client-1"),
			env as never,
			{} as never,
		);
		const html = await dialog.text();
		const state = html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";
		const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1] ?? "";
		expect(state).not.toBe("");
		const csrfCookie = (dialog.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

		const approved = await WallosHandler.fetch(
			new Request("https://server.example/authorize", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Cookie: csrfCookie.trim(),
				},
				body: new URLSearchParams({ state, csrf_token: csrf }).toString(),
			}),
			env as never,
			{} as never,
		);

		expect(approved.status).toBe(302);
		expect(approved.headers.get("Location") ?? "").toMatch(/\/sign-in\?state=/);
		const cookies = approved.headers.getSetCookie();
		expect(cookies.some((c) => c.startsWith("__Host-CONSENTED_STATE="))).toBe(true);
		expect(cookies.some((c) => c.startsWith("__Host-APPROVED_CLIENTS="))).toBe(true);
	});
});
