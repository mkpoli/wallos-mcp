import { afterEach, describe, expect, test } from "bun:test";
import {
	addPeriod,
	deriveNextPayment,
	encodeForm,
	parseBillingPeriod,
	parseBillingPeriodString,
	parseWallosJson,
	resolveSubscriptionRefs,
	todayIn,
	WallosClient,
	WallosError,
} from "../src/wallos";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
		handler(String(input), init)) as typeof fetch;
}

const KEY = "test-api-key-xyz";

describe("encodeForm", () => {
	test("encodes as application/x-www-form-urlencoded and skips empty fields", () => {
		expect(encodeForm({ name: "Netflix", price: 15.99, notes: undefined })).toBe(
			"name=Netflix&price=15.99",
		);
		expect(encodeForm({ auto_renew: true, inactive: false })).toBe("auto_renew=1&inactive=0");
	});
});

describe("the always-200 error convention", () => {
	test("HTTP 200 with success:false is an error using title and message", () => {
		expect(() =>
			parseWallosJson(
				JSON.stringify({ success: false, title: "Unauthorized", message: "Invalid API key." }),
				KEY,
			),
		).toThrow(new WallosError("Unauthorized", "Invalid API key.").message);
	});

	test("HTTP 200 with success:true is the payload", () => {
		const body = parseWallosJson(
			JSON.stringify({ success: true, title: "user", user: { id: 1 } }),
			KEY,
		);
		expect(body.title).toBe("user");
	});

	test("non-JSON is refused as not Wallos", () => {
		expect(() => parseWallosJson("<html>login</html>", KEY)).toThrow(/Not a Wallos/);
	});

	test("the API key never appears in the error", () => {
		expect(() =>
			parseWallosJson(
				JSON.stringify({
					success: false,
					title: "Error",
					message: `bad key ${KEY}`,
				}),
				KEY,
			),
		).toThrow(/\[redacted\]/);
	});
});

describe("form encoding on the wire", () => {
	test("POSTs a form body and keeps the key out of the URL", async () => {
		let seen = { url: "", method: "", contentType: "", body: "" };
		mockFetch((url, init) => {
			seen = {
				url,
				method: init?.method ?? "GET",
				contentType: String(init?.headers && new Headers(init.headers).get("content-type")),
				body: String(init?.body),
			};
			return Response.json({ success: true, user: { id: 1, username: "jane" } });
		});
		const client = new WallosClient("https://wallos.example.com", KEY);
		await client.getUser();
		expect(seen.method).toBe("POST");
		expect(seen.url).toBe("https://wallos.example.com/api/users/get_user.php");
		expect(seen.url).not.toContain(KEY);
		expect(seen.contentType).toBe("application/x-www-form-urlencoded");
		const params = new URLSearchParams(seen.body);
		expect(params.get("api_key")).toBe(KEY);
	});
});

describe("billing-period parsing", () => {
	test("named periods", () => {
		expect(parseBillingPeriodString("monthly")).toEqual({ cycle: 3, frequency: 1 });
		expect(parseBillingPeriodString("biweekly")).toEqual({ cycle: 2, frequency: 2 });
		expect(parseBillingPeriodString("quarterly")).toEqual({ cycle: 3, frequency: 3 });
		expect(parseBillingPeriodString("semiannually")).toEqual({ cycle: 3, frequency: 6 });
		expect(parseBillingPeriodString("yearly")).toEqual({ cycle: 4, frequency: 1 });
	});

	test("every N unit", () => {
		expect(parseBillingPeriodString("every 2 weeks")).toEqual({ cycle: 2, frequency: 2 });
		expect(parseBillingPeriodString("every 10 days")).toEqual({ cycle: 1, frequency: 10 });
	});

	test("cycle and frequency, defaulting to monthly", () => {
		expect(parseBillingPeriod({})).toEqual({ cycle: 3, frequency: 1 });
		expect(parseBillingPeriod({ cycle: 4, frequency: 2 })).toEqual({ cycle: 4, frequency: 2 });
	});

	test("billing_period wins over cycle", () => {
		expect(parseBillingPeriod({ billing_period: "weekly", cycle: 3, frequency: 1 })).toEqual({
			cycle: 2,
			frequency: 1,
		});
	});

	test("rejects an unknown string", () => {
		expect(() => parseBillingPeriodString("fortnightly")).toThrow(/not a billing period/);
	});
});

describe("next-payment derivation", () => {
	test("a start date on or after today is used as-is", () => {
		expect(deriveNextPayment("2026-08-14", 3, 1, "2026-08-14")).toBe("2026-08-14");
		expect(deriveNextPayment("2026-09-01", 3, 1, "2026-08-14")).toBe("2026-09-01");
	});

	test("advances whole months and clamps short months", () => {
		// 31 Jan + 1 month is 28 Feb in a common year; then March 31, …
		expect(deriveNextPayment("2026-01-31", 3, 1, "2026-03-01")).toBe("2026-03-31");
		// A subscription started on the 31st bills on the 30th in November.
		expect(deriveNextPayment("2026-01-31", 3, 1, "2026-11-01")).toBe("2026-11-30");
	});

	test("leap day clamps on the following year", () => {
		expect(deriveNextPayment("2024-02-29", 4, 1, "2025-01-01")).toBe("2025-02-28");
	});

	test("weeks and days", () => {
		expect(deriveNextPayment("2026-08-01", 2, 1, "2026-08-14")).toBe("2026-08-15");
		expect(deriveNextPayment("2026-08-10", 1, 3, "2026-08-14")).toBe("2026-08-16");
	});
});

const MASTER = {
	success: true,
	categories: [{ id: 1, name: "General" }],
	payment_methods: [{ id: 2, name: "PayPal" }],
	household: [{ id: 3, name: "Jane" }],
	currencies: [{ id: 9, name: "Euro", code: "EUR", symbol: "€" }],
	main_currency: 9,
};

function serveMaster(
	routes: Record<string, (init?: RequestInit) => unknown> = {},
	calls: { url: string; body: URLSearchParams }[] = [],
) {
	const defaults: [string, unknown][] = [
		["get_categories", MASTER],
		["get_currencies", MASTER],
		["get_payment_methods", MASTER],
		["get_household", MASTER],
	];
	mockFetch((url, init) => {
		const body = new URLSearchParams(String(init?.body ?? ""));
		calls.push({ url, body });
		for (const [pattern, route] of Object.entries(routes)) {
			if (url.includes(pattern)) {
				const value = route(init);
				return value instanceof Response ? value : Response.json(value);
			}
		}
		for (const [pattern, payload] of defaults) {
			if (url.includes(pattern)) return Response.json(payload);
		}
		return Response.json({ success: false, title: "missing", message: url });
	});
	return calls;
}

describe("name resolution", () => {
	test("an explicit id wins over a name", async () => {
		serveMaster();
		const client = new WallosClient("https://wallos.example.com", KEY);
		const ids = await resolveSubscriptionRefs(
			client,
			{ category_id: 99, category_name: "General", create_missing: true },
			false,
		);
		expect(ids.category_id).toBe(99);
	});

	test("matches a name case-insensitively", async () => {
		serveMaster();
		const client = new WallosClient("https://wallos.example.com", KEY);
		const ids = await resolveSubscriptionRefs(
			client,
			{ category_name: "general", payment_method_name: "paypal", payer_name: "JANE" },
			false,
		);
		expect(ids).toEqual({
			category_id: 1,
			payment_method_id: 2,
			payer_user_id: 3,
		});
	});

	test("falls back to the main currency when none is given", async () => {
		serveMaster();
		const client = new WallosClient("https://wallos.example.com", KEY);
		const ids = await resolveSubscriptionRefs(client, {}, true);
		expect(ids.currency_id).toBe(9);
	});

	test("creates a missing name when create_missing is true", async () => {
		const calls = serveMaster({
			"set_categories.php": () => ({ success: true, categoryId: 44, message: "ok" }),
		});
		const client = new WallosClient("https://wallos.example.com", KEY);
		const ids = await resolveSubscriptionRefs(
			client,
			{ category_name: "Streaming", create_missing: true },
			false,
		);
		expect(ids.category_id).toBe(44);
		const created = calls.find((c) => c.url.includes("set_categories"));
		expect(created?.body.get("action")).toBe("add");
		expect(created?.body.get("name")).toBe("Streaming");
		expect(created?.body.get("api_key")).toBe(KEY);
	});

	test("names the available options when create_missing is false", async () => {
		serveMaster();
		const client = new WallosClient("https://wallos.example.com", KEY);
		await expect(
			resolveSubscriptionRefs(client, { category_name: "Streaming", create_missing: false }, false),
		).rejects.toThrow(/Available: General/);
	});

	test("creates a missing currency from its ISO code", async () => {
		const calls = serveMaster({
			"set_currencies.php": () => ({ success: true, currencyId: 12 }),
		});
		const client = new WallosClient("https://wallos.example.com", KEY);
		const ids = await resolveSubscriptionRefs(client, { currency_code: "JPY" }, true);
		expect(ids.currency_id).toBe(12);
		const created = calls.find((c) => c.url.includes("set_currencies"));
		expect(created?.body.get("code")).toBe("JPY");
		expect(created?.body.get("action")).toBe("add");
	});
});

// A deliberately slow reference: step one period at a time from the start date.
// The implementation skips ahead for speed, and this is what it must agree with.
function firstPeriodOnOrAfter(
	startDate: string,
	cycle: 1 | 2 | 3 | 4,
	frequency: number,
	today: string,
): string {
	for (let n = 0; n < 100_000; n++) {
		const candidate = addPeriod(startDate, cycle, frequency, n);
		if (candidate >= today) return candidate;
	}
	throw new Error("reference never reached today");
}

describe("deriveNextPayment over long spans", () => {
	test("agrees with stepping one period at a time, from 1970 to now", () => {
		for (const [cycle, frequency] of [
			[1, 1],
			[1, 3],
			[2, 1],
			[2, 2],
			[3, 1],
			[3, 6],
			[4, 1],
		] as const) {
			expect(deriveNextPayment("1970-01-01", cycle, frequency, "2026-08-14")).toBe(
				firstPeriodOnOrAfter("1970-01-01", cycle, frequency, "2026-08-14"),
			);
		}
	});

	test("month ends, leap days and year boundaries", () => {
		expect(deriveNextPayment("2020-01-31", 3, 1, "2026-08-14")).toBe("2026-08-31");
		expect(deriveNextPayment("2020-02-29", 4, 1, "2026-08-14")).toBe("2027-02-28");
		expect(deriveNextPayment("2026-08-03", 2, 1, "2026-08-14")).toBe("2026-08-17");
		expect(deriveNextPayment("2025-12-31", 3, 1, "2026-01-01")).toBe("2026-01-31");
	});

	test("a start date in the future is its own next payment", () => {
		expect(deriveNextPayment("2027-01-01", 3, 1, "2026-08-14")).toBe("2027-01-01");
	});
});

describe("todayIn", () => {
	// 2026-08-14T15:30Z is already the 15th in Tokyo and still the 14th in UTC.
	const at = Date.UTC(2026, 7, 14, 15, 30);

	test("reads the calendar date in the named zone", () => {
		expect(todayIn("Asia/Tokyo", at)).toBe("2026-08-15");
		expect(todayIn("UTC", at)).toBe("2026-08-14");
		expect(todayIn("America/Los_Angeles", at)).toBe("2026-08-14");
	});

	test("falls back to UTC when no zone is given", () => {
		expect(todayIn(undefined, at)).toBe("2026-08-14");
	});

	test("refuses a name that is not a timezone", () => {
		expect(() => todayIn("Mars/Olympus", at)).toThrow(/IANA/);
	});
});
