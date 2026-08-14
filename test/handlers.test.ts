import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "./runtime-shim";

const { WallosMCP, default: worker } = await import("../src/index");

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
type Route = (url: string, init: RequestInit) => unknown;

const realFetch = globalThis.fetch;
let requests: { url: string; method: string; body: URLSearchParams }[] = [];

function serveWallos(routes: [RegExp, Route][]) {
	globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = String(input);
		requests.push({
			url,
			method: init.method ?? "GET",
			body: new URLSearchParams(String(init.body ?? "")),
		});
		for (const [pattern, route] of routes) {
			if (pattern.test(url)) {
				const value = route(url, init);
				if (value instanceof Response) return value;
				return new Response(JSON.stringify(value), { status: 200 });
			}
		}
		if (url.includes("version.php")) {
			return Response.json({ success: true, version: "v5.4.2", version_number: "5.4.2" });
		}
		return Response.json({ success: false, title: "no route", message: url });
	}) as unknown as typeof fetch;
}

const OWNER = "https://wallos.example.com:1";

function makeAgent(account = OWNER, version = "v5.4.2") {
	const handlers = new Map<string, Handler>();
	const storage = new Map<string, unknown>();
	const agent = Object.create(WallosMCP.prototype) as Record<string, unknown>;
	agent.server = {
		tool: (name: string, _d: string, _s: unknown, cb: Handler) => handlers.set(name, cb),
	};
	agent.props = {
		baseUrl: "https://wallos.example.com",
		apiKey: "owner-key",
		userId: Number(account.split(":").pop() ?? 1),
		username: "jane",
		email: "jane@example.com",
		version,
	};
	agent.ctx = {
		id: { name: "streamable-http:session-1" },
		storage: {
			get: async (key: string) => storage.get(key),
			put: async (key: string, value: unknown) => {
				storage.set(key, value);
			},
		},
	};
	agent.env = { ADMIN_TOOLS: "0", RATE_LIMITER: undefined };
	agent.callerAccount = account;
	agent.periodBudget = false;
	agent.adminTools = false;
	return { agent, handlers, storage };
}

async function boot(account?: string, version?: string) {
	const made = makeAgent(account, version);
	await (made.agent as { init: () => Promise<void> }).init();
	return made;
}

function tool(handlers: Map<string, Handler>, name: string): Handler {
	const handler = handlers.get(name);
	if (!handler) throw new Error(`no handler registered for ${name}`);
	return handler;
}

function result(reply: { content: { text: string }[] }): Record<string, unknown> {
	return JSON.parse(reply.content[0]?.text ?? "{}");
}

beforeEach(() => {
	requests = [];
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("props isolation between grants", () => {
	test("the first account to call claims the session", async () => {
		serveWallos([
			[/version\.php/, () => ({ success: true, version: "v5.4.2" })],
			[
				/get_user\.php/,
				() => ({ success: true, user: { id: 1, username: "jane", email: "jane@example.com" } }),
			],
		]);
		const { handlers, storage } = await boot(OWNER);
		await tool(handlers, "whoami")({});
		expect(storage.get("owner")).toBe(OWNER);
	});

	test("a second account cannot use a claimed session", async () => {
		serveWallos([
			[/version\.php/, () => ({ success: true, version: "v5.4.2" })],
			[
				/get_user\.php/,
				() => ({ success: true, user: { id: 1, username: "jane", email: "jane@example.com" } }),
			],
		]);
		const { agent, handlers, storage } = await boot(OWNER);
		await tool(handlers, "whoami")({});

		(agent as { callerAccount: string }).callerAccount = "other.example.com:9";
		(agent as { props: { userId: number; baseUrl: string } }).props.userId = 9;
		(agent as { props: { baseUrl: string } }).props.baseUrl = "https://other.example.com";
		await expect(tool(handlers, "whoami")({})).rejects.toThrow(/different Wallos account/);
		expect(storage.get("owner")).toBe(OWNER);
	});

	test("refuses credentials that no longer belong to the owner", async () => {
		serveWallos([
			[/version\.php/, () => ({ success: true, version: "v5.4.2" })],
			[
				/get_user\.php/,
				() => ({ success: true, user: { id: 1, username: "jane", email: "jane@example.com" } }),
			],
		]);
		const { agent, handlers } = await boot(OWNER);
		await tool(handlers, "whoami")({});

		(agent as { callerAccount: string }).callerAccount = OWNER;
		const props = (agent as { props: Record<string, string | number> }).props;
		props.userId = 9;
		props.baseUrl = "https://other.example.com";
		props.apiKey = "intruder-key";
		await expect(tool(handlers, "whoami")({})).rejects.toThrow(/different Wallos account/);
		expect(requests.some((r) => r.body.get("api_key") === "intruder-key")).toBe(false);
	});

	test("refuses to start on a grant that does not own the session", async () => {
		serveWallos([[/version\.php/, () => ({ success: true, version: "v5.4.2" })]]);
		const made = makeAgent("other.example.com:9");
		made.storage.set("owner", OWNER);
		await expect((made.agent as { init: () => Promise<void> }).init()).rejects.toThrow(
			/different Wallos account/,
		);

		const props = (made.agent as { props: Record<string, string | number> }).props;
		props.userId = 1;
		props.baseUrl = "https://wallos.example.com";
		(made.agent as { callerAccount: string }).callerAccount = OWNER;
		await (made.agent as { init: () => Promise<void> }).init();
		expect(made.handlers.has("whoami")).toBe(true);
	});
});

describe("version-gated tools", () => {
	test("registers get_period_budget on 5.3 and later", async () => {
		serveWallos([[/version\.php/, () => ({ success: true, version: "v5.4.2" })]]);
		const { handlers } = await boot(OWNER, "v5.4.2");
		expect(handlers.has("get_period_budget")).toBe(true);
		expect(handlers.has("get_admin_settings")).toBe(false);
	});

	test("omits get_period_budget on 5.2.0", async () => {
		serveWallos([[/version\.php/, () => ({ success: true, version: "v5.2.0" })]]);
		const { handlers } = await boot(OWNER, "v5.2.0");
		expect(handlers.has("get_period_budget")).toBe(false);
	});
});

describe("create_subscription name resolution", () => {
	test("creates a missing category and posts a form add", async () => {
		serveWallos([
			[/version\.php/, () => ({ success: true, version: "v5.4.2" })],
			[/get_categories/, () => ({ success: true, categories: [{ id: 1, name: "General" }] })],
			[
				/get_currencies/,
				() => ({
					success: true,
					main_currency: 9,
					currencies: [{ id: 9, name: "Euro", code: "EUR", symbol: "€" }],
				}),
			],
			[/get_payment_methods/, () => ({ success: true, payment_methods: [] })],
			[/get_household/, () => ({ success: true, household: [] })],
			[/set_categories/, () => ({ success: true, categoryId: 4 })],
			[
				/set_subscriptions/,
				() => ({ success: true, subscriptionId: 55, title: "Subscription added" }),
			],
		]);
		const { handlers } = await boot();
		const out = result(
			await tool(
				handlers,
				"create_subscription",
			)({
				name: "Netflix",
				price: 15.99,
				category_name: "Streaming",
				billing_period: "monthly",
			}),
		);
		expect(out.subscriptionId).toBe(55);
		const created = requests.find((r) => r.url.includes("set_categories"));
		expect(created?.method).toBe("POST");
		expect(created?.body.get("action")).toBe("add");
		const added = requests.find((r) => r.url.includes("set_subscriptions"));
		expect(added?.body.get("category_id")).toBe("4");
		expect(added?.body.get("currency_id")).toBe("9");
		expect(added?.url).not.toContain("owner-key");
	});
});

describe("the headers the boundary hands on", () => {
	test("drops a client's own account and props headers", async () => {
		const seen: Headers[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request) => {
			seen.push(new Request(input).headers);
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		try {
			await worker.fetch(
				new Request("https://example.com/mcp", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-wallos-mcp-account": "intruder.example.com:9",
						"x-partykit-props": "eyJ1c2VySWQiOjl9",
					},
					body: "{}",
				}),
				{} as never,
				{} as never,
			);
		} catch {
			// The provider refuses the unauthenticated call; what matters is that
			// nothing downstream ever saw the client's headers.
		} finally {
			globalThis.fetch = original;
		}
		for (const headers of seen) {
			expect(headers.get("x-partykit-props")).toBeNull();
			expect(headers.get("x-wallos-mcp-account")).toBeNull();
		}
	});
});

describe("bounded bodies", () => {
	const CHUNK = 64 * 1024;
	function streamed(path: string, chunks: number) {
		let pulled = 0;
		const request = new Request(`https://example.com${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: new ReadableStream({
				pull(controller) {
					if (pulled >= chunks) {
						controller.close();
						return;
					}
					pulled += 1;
					controller.enqueue(new Uint8Array(CHUNK));
				},
			}),
			duplex: "half",
		} as RequestInit);
		return { request, offered: () => pulled };
	}

	test("stops reading a body too large to hold at /register", async () => {
		const { request, offered } = streamed("/register", 512);
		const response = await worker.fetch(request, {} as never, {} as never);
		expect(response.status).toBe(413);
		expect(offered()).toBeLessThan(8);
	});
});
