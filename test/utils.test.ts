import { describe, expect, test } from "bun:test";
import {
	accountId,
	hasPeriodBudget,
	isHostAllowed,
	isPrivateHost,
	isUnderAccountCap,
	meetsMinimum,
	normalizeBaseUrl,
	parseLimit,
	redactSecret,
	redactSecrets,
} from "../src/utils";

describe("isHostAllowed", () => {
	test("admits no one when unset or empty", () => {
		expect(isHostAllowed("wallos.example.com", undefined)).toBe(false);
		expect(isHostAllowed("wallos.example.com", "")).toBe(false);
		expect(isHostAllowed("wallos.example.com", "  , ,  ")).toBe(false);
	});

	test("matches an exact host case-insensitively", () => {
		expect(isHostAllowed("Wallos.Example.com", "wallos.example.com")).toBe(true);
		expect(isHostAllowed("other.example.com", "wallos.example.com")).toBe(false);
	});

	test("matches a wildcard only under that domain", () => {
		expect(isHostAllowed("home.example.com", "*.example.com")).toBe(true);
		expect(isHostAllowed("a.b.example.com", "*.example.com")).toBe(true);
		expect(isHostAllowed("example.com", "*.example.com")).toBe(false);
		expect(isHostAllowed("notexample.com", "*.example.com")).toBe(false);
		expect(isHostAllowed("example.com.evil.net", "*.example.com")).toBe(false);
	});

	test("wildcard admits any host", () => {
		expect(isHostAllowed("anywhere.org", "*")).toBe(true);
		expect(isHostAllowed("wallos.example.com", "other.test, *")).toBe(true);
	});
});

describe("isUnderAccountCap", () => {
	test("lets a known account through whatever the count", () => {
		expect(isUnderAccountCap(999, false, 25)).toBe(true);
		expect(isUnderAccountCap(999, false, 0)).toBe(true);
	});

	test("admits a new account below the cap and refuses it at the cap", () => {
		expect(isUnderAccountCap(24, true, 25)).toBe(true);
		expect(isUnderAccountCap(25, true, 25)).toBe(false);
		expect(isUnderAccountCap(26, true, 25)).toBe(false);
	});

	test("a cap of zero or less admits nobody new", () => {
		expect(isUnderAccountCap(0, true, 0)).toBe(false);
		expect(isUnderAccountCap(0, true, Number.NaN)).toBe(false);
	});

	test("an uncountable number of accounts refuses a new one", () => {
		expect(isUnderAccountCap(Number.POSITIVE_INFINITY, true, 25)).toBe(false);
		expect(isUnderAccountCap(Number.POSITIVE_INFINITY, false, 25)).toBe(true);
	});
});

describe("parseLimit", () => {
	test("reads a positive integer and falls back otherwise", () => {
		expect(parseLimit("50", 25)).toBe(50);
		expect(parseLimit(undefined, 25)).toBe(25);
		expect(parseLimit("nope", 25)).toBe(25);
		expect(parseLimit("0", 25)).toBe(25);
	});
});

describe("normalizeBaseUrl", () => {
	test("strips a trailing slash and keeps a path prefix", () => {
		expect(normalizeBaseUrl("https://wallos.example.com/")).toBe("https://wallos.example.com");
		expect(normalizeBaseUrl("https://example.com/wallos/")).toBe("https://example.com/wallos");
	});

	test("refuses credentials and non-http schemes", () => {
		expect(() => normalizeBaseUrl("https://user:pass@example.com")).toThrow(/credentials/);
		expect(() => normalizeBaseUrl("javascript:alert(1)")).toThrow(/https/);
		expect(() => normalizeBaseUrl("http://wallos.example.com")).toThrow(/https/);
		expect(() => normalizeBaseUrl("not a url")).toThrow(/absolute/);
	});
});

describe("accountId", () => {
	test("keys a grant by host and user id", () => {
		expect(accountId("https://Wallos.Example.com", 3)).toBe("https://wallos.example.com:3");
	});

	test("two installations on one host are two accounts", () => {
		expect(accountId("https://example.com/wallos", 1)).not.toBe(
			accountId("https://example.com/wallos-home", 1),
		);
		expect(accountId("https://example.com:8080", 1)).not.toBe(accountId("https://example.com", 1));
	});
});

describe("isPrivateHost", () => {
	test("public names are not private", () => {
		expect(isPrivateHost("wallos.example.com")).toBe(false);
		expect(isPrivateHost("203.0.113.10")).toBe(false);
	});

	test("loopback, RFC1918, CGNAT and link-local are", () => {
		for (const host of [
			"localhost",
			"wallos.localhost",
			"127.0.0.1",
			"10.0.0.5",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"100.64.0.1",
			"169.254.169.254",
			"metadata.google.internal",
			"printer.local",
			"::1",
			"[::1]",
			"::ffff:10.0.0.1",
			"fd00::1",
			"fe80::1",
		]) {
			expect(isPrivateHost(host)).toBe(true);
		}
	});

	test("172.32 and 100.128 are outside the private ranges", () => {
		expect(isPrivateHost("172.32.0.1")).toBe(false);
		expect(isPrivateHost("100.128.0.1")).toBe(false);
	});
});

describe("hasPeriodBudget", () => {
	test("is off on 5.2.0 and on from 5.3.0", () => {
		expect(hasPeriodBudget("v5.2.0")).toBe(false);
		expect(hasPeriodBudget("5.3.0")).toBe(true);
		expect(hasPeriodBudget("v5.4.2")).toBe(true);
		expect(hasPeriodBudget("unknown")).toBe(false);
	});
});

describe("redactSecret", () => {
	test("removes the API key from a message", () => {
		expect(redactSecret("key=secret-abc failed", "secret-abc")).toBe("key=[redacted] failed");
	});
});

describe("redactSecrets", () => {
	test("masks known secret fields", () => {
		const out = redactSecrets({
			user: { username: "jane", api_key: "live-key", password: "hash" },
			notes: [],
		}) as { user: { username: string; api_key: string } };
		expect(out.user.username).toBe("jane");
		expect(out.user.api_key).toBe("********");
	});
});

describe("meetsMinimum", () => {
	test("5.0.0 is the floor", () => {
		expect(meetsMinimum("v5.0.0")).toBe(true);
		expect(meetsMinimum("5.2.0")).toBe(true);
		expect(meetsMinimum("v5.4.2")).toBe(true);
		expect(meetsMinimum("v4.9.9")).toBe(false);
		expect(meetsMinimum("v3.0.0")).toBe(false);
	});

	test("an unreadable version is not treated as ancient", () => {
		expect(meetsMinimum("unknown")).toBe(true);
	});
});
