// Exercises the Wallos client against a running instance, which is the only
// place the wire contract is actually settled: every endpoint answers HTTP 200,
// so a wrong field name reads as a successful call returning the wrong rows.
//
//   WALLOS_URL=https://wallos.example.com WALLOS_API_KEY=... bun run scripts/e2e.ts
//   … --write   also creates, edits and deletes a subscription and a category
//
// The write pass leaves nothing behind: every row it creates it deletes, and it
// names them so an interrupted run is recognisable in the UI.

import { WallosClient } from "../src/wallos";

const baseUrl = process.env.WALLOS_URL;
const apiKey = process.env.WALLOS_API_KEY;
if (!baseUrl || !apiKey) {
	console.error("WALLOS_URL and WALLOS_API_KEY are required");
	process.exit(2);
}

const write = process.argv.includes("--write");
const client = new WallosClient(baseUrl.replace(/\/+$/, ""), apiKey);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

let failures = 0;
async function check(name: string, run: () => Promise<string>): Promise<void> {
	try {
		console.log(`  ok    ${name} — ${await run()}`);
	} catch (error: unknown) {
		failures++;
		console.log(`  FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`);
	}
}

function expect(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

console.log(`\nreads · ${baseUrl}`);

await check("get_version", async () => {
	const v = await client.getVersion();
	expect(/^v?\d+\./.test(v.version), `unexpected version ${v.version}`);
	return v.version;
});

await check("get_user", async () => {
	const user = (await client.getUser()) as { id: number; username: string };
	expect(typeof user.id === "number", "no user id");
	return `#${user.id} ${user.username}`;
});

await check("get_master_data", async () => {
	const data = await client.getMasterData();
	expect(data.categories.length > 0, "no categories");
	expect(data.currencies.length > 0, "no currencies");
	return `${data.categories.length} categories, ${data.currencies.length} currencies, ${data.payment_methods.length} payment methods, ${data.household.length} members`;
});

await check("list_subscriptions", async () => {
	const { subscriptions } = (await client.getSubscriptions()) as {
		subscriptions: { id: number }[];
	};
	expect(Array.isArray(subscriptions), "no subscriptions array");
	return `${subscriptions.length} rows`;
});

// The flag Wallos compares with === 'true'. Sent as "1" it is silently ignored,
// and every price comes back in its own currency while claiming conversion.
await check("convert_currency is honoured", async () => {
	const raw = (await client.getSubscriptions()) as { subscriptions: Record<string, number>[] };
	const converted = (await client.getSubscriptions({ convert_currency: "true" })) as {
		subscriptions: Record<string, number>[];
	};
	const foreign = raw.subscriptions.findIndex((s) => s.currency_id !== undefined);
	expect(foreign >= 0, "no subscriptions to compare");
	const changed = raw.subscriptions.some((s, i) => s.price !== converted.subscriptions[i]?.price);
	expect(
		changed,
		"no price changed — either every row is in the main currency, or the flag was ignored",
	);
	return "prices differ from the unconverted read";
});

// The filter Wallos reads as `payment`, not `payment_method`.
await check("payment filter narrows the list", async () => {
	const all = (await client.getSubscriptions()) as { subscriptions: unknown[] };
	const filtered = (await client.getSubscriptions({ payment: 1 })) as { subscriptions: unknown[] };
	expect(
		filtered.subscriptions.length <= all.subscriptions.length,
		"filtered list is larger than the unfiltered one",
	);
	return `${filtered.subscriptions.length} of ${all.subscriptions.length}`;
});

await check("get_monthly_cost", async () => {
	const now = new Date();
	const cost = (await client.getMonthlyCost(now.getUTCMonth() + 1, now.getUTCFullYear())) as {
		localized_monthly_cost: string;
	};
	return cost.localized_monthly_cost;
});

await check("get_settings", async () => {
	const { settings } = (await client.getSettings()) as { settings: Record<string, unknown> };
	return `${Object.keys(settings).length} keys`;
});

await check("an invalid key is refused", async () => {
	const stranger = new WallosClient(baseUrl.replace(/\/+$/, ""), "0".repeat(64));
	try {
		await stranger.getUser();
	} catch (error: unknown) {
		return error instanceof Error ? error.message : "refused";
	}
	throw new Error("a wrong API key was accepted");
});

if (write) {
	console.log("\nwrites");
	const categoryName = `wallos-mcp e2e ${stamp}`;
	let categoryId = 0;
	let subscriptionId = 0;

	await check("create_category", async () => {
		categoryId = await client.addCategory(categoryName);
		expect(categoryId > 0, "no category id");
		return `#${categoryId}`;
	});

	await check("create_subscription", async () => {
		const { currencies, main_currency } = await client.getMasterData();
		const currencyId = main_currency || currencies[0]?.id || 1;
		const body = (await client.setSubscription({
			action: "add",
			name: `wallos-mcp e2e ${stamp}`,
			price: 1,
			currency_id: currencyId,
			cycle: 3,
			frequency: 1,
			category_id: categoryId || undefined,
			start_date: new Date().toISOString().slice(0, 10),
			next_payment: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
			notes: "created by scripts/e2e.ts",
		})) as { subscriptionId?: number };
		subscriptionId = Number(body.subscriptionId ?? 0);
		expect(subscriptionId > 0, "no subscription id");
		return `#${subscriptionId}`;
	});

	await check("update_subscription", async () => {
		await client.setSubscription({ action: "edit", id: subscriptionId, price: 2 });
		const { subscription } = (await client.getSubscription(subscriptionId)) as {
			subscription: { price: number };
		};
		expect(Number(subscription.price) === 2, `price is ${subscription.price}, expected 2`);
		return "price 1 → 2 read back";
	});

	await check("delete_subscription", async () => {
		await client.setSubscription({ action: "delete", id: subscriptionId });
		const { subscriptions } = (await client.getSubscriptions()) as {
			subscriptions: { id: number }[];
		};
		expect(!subscriptions.some((s) => s.id === subscriptionId), "subscription still listed");
		return "gone from the list";
	});

	await check("delete_category", async () => {
		await client.setCategory({ action: "delete", id: categoryId });
		const { categories } = await client.getMasterData();
		expect(!categories.some((c) => c.id === categoryId), "category still listed");
		return "gone from the list";
	});
}

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
