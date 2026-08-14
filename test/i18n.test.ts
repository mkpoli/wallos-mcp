import { describe, expect, test } from "bun:test";
import { isRtl, LOCALES, pickLocale, strings } from "../src/i18n";

describe("pickLocale", () => {
	test("reads the header in preference order", () => {
		expect(pickLocale("ja,en;q=0.8")).toBe("ja");
		expect(pickLocale("en-GB,en;q=0.9")).toBe("en");
		expect(pickLocale("de-AT,de;q=0.9,en;q=0.5")).toBe("de");
	});

	test("maps regions onto the locales Wallos names", () => {
		expect(pickLocale("zh-TW")).toBe("zh_tw");
		expect(pickLocale("zh-Hant-HK")).toBe("zh_tw");
		expect(pickLocale("zh-CN")).toBe("zh_cn");
		expect(pickLocale("zh")).toBe("zh_cn");
		expect(pickLocale("pt-BR")).toBe("pt_br");
		expect(pickLocale("pt-PT")).toBe("pt");
	});

	test("an explicit choice wins, an unknown one does not", () => {
		expect(pickLocale("ja", "fr")).toBe("fr");
		expect(pickLocale("ja", "klingon")).toBe("ja");
		expect(pickLocale(null)).toBe("en");
		expect(pickLocale("")).toBe("en");
	});

	test("q=0 does not outrank a real preference", () => {
		expect(pickLocale("de;q=0,ja;q=0.7")).toBe("ja");
	});
});

describe("strings", () => {
	test("every locale in the picker resolves to a full bundle", () => {
		const keys = Object.keys(strings("en"));
		for (const { code } of LOCALES) {
			const bundle = strings(code) as Record<string, string>;
			for (const key of keys) {
				expect(typeof bundle[key]).toBe("string");
				expect(bundle[key]?.length).toBeGreaterThan(0);
			}
		}
	});

	test("a translated locale is not just English", () => {
		expect(strings("ja").submit).not.toBe(strings("en").submit);
		expect(strings("ar").heading).not.toBe(strings("en").heading);
	});

	test("Arabic is the right-to-left one", () => {
		expect(isRtl("ar")).toBe(true);
		expect(isRtl("he")).toBe(false);
		expect(isRtl("en")).toBe(false);
	});
});
