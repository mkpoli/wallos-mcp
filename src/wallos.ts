import { MAX_RESPONSE_BYTES, readBoundedText, redactSecret, redactSecrets } from "./utils";

const WALLOS_TIMEOUT_MS = 30_000;

export type FormValue = string | number | boolean | undefined | null;

export type Cycle = 1 | 2 | 3 | 4;

export type CycleFrequency = {
	cycle: Cycle;
	frequency: number;
};

export type NamedItem = {
	id: number;
	name: string;
	// Whether a subscription still references this row. Wallos deletes without
	// asking, so a caller that cannot see this cannot warn before orphaning one.
	in_use?: boolean;
	// Payment methods carry an enabled flag; household members carry an address.
	enabled?: number;
	email?: string;
};

export type CurrencyItem = NamedItem & {
	code: string;
	symbol: string;
	rate?: string;
	in_use?: boolean;
};

export type MasterData = {
	categories: NamedItem[];
	payment_methods: NamedItem[];
	household: NamedItem[];
	currencies: CurrencyItem[];
	main_currency: number;
};

export type NameRefs = {
	category_id?: number | undefined;
	category_name?: string | undefined;
	payment_method_id?: number | undefined;
	payment_method_name?: string | undefined;
	payer_user_id?: number | undefined;
	payer_name?: string | undefined;
	currency_id?: number | undefined;
	currency_code?: string | undefined;
	create_missing?: boolean | undefined;
};

export type ResolvedIds = {
	category_id?: number;
	payment_method_id?: number;
	payer_user_id?: number;
	currency_id?: number;
};

export class WallosError extends Error {
	constructor(
		readonly title: string,
		readonly detail: string,
	) {
		super(detail ? `${title}: ${detail}` : title);
		this.name = "WallosError";
	}
}

// PHP only fills $_POST from a form body. A JSON body arrives empty and every
// write answers "Missing API key".
export function encodeForm(fields: Record<string, FormValue>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === null) continue;
		if (typeof value === "boolean") {
			params.set(key, value ? "1" : "0");
			continue;
		}
		params.set(key, String(value));
	}
	return params.toString();
}

export function parseWallosJson(text: string, apiKey: string): Record<string, unknown> {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new WallosError(
			"Not a Wallos instance",
			"The URL did not return JSON. Check that it points at Wallos and that the API is reachable.",
		);
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new WallosError("Not a Wallos instance", "The URL returned JSON that is not an object.");
	}
	const body = data as Record<string, unknown>;
	if (body.success === false) {
		const title = redactSecret(stringField(body.title) || "Request failed", apiKey);
		const message = redactSecret(stringField(body.message), apiKey);
		throw new WallosError(title, message);
	}
	return body;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function numberField(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return fallback;
}

function asItems(value: unknown): NamedItem[] {
	if (!Array.isArray(value)) return [];
	const out: NamedItem[] = [];
	for (const row of value) {
		if (!row || typeof row !== "object") continue;
		const rec = row as Record<string, unknown>;
		const id = numberField(rec.id, Number.NaN);
		const name = stringField(rec.name);
		if (!Number.isFinite(id) || !name) continue;
		const item: NamedItem = { id, name };
		if (typeof rec.in_use === "boolean") item.in_use = rec.in_use;
		if (typeof rec.enabled === "number") item.enabled = rec.enabled;
		if (typeof rec.email === "string" && rec.email) item.email = rec.email;
		out.push(item);
	}
	return out;
}

function asCurrencies(value: unknown): CurrencyItem[] {
	if (!Array.isArray(value)) return [];
	const out: CurrencyItem[] = [];
	for (const row of value) {
		if (!row || typeof row !== "object") continue;
		const rec = row as Record<string, unknown>;
		const id = numberField(rec.id, Number.NaN);
		const name = stringField(rec.name);
		const code = stringField(rec.code);
		if (!Number.isFinite(id) || !name || !code) continue;
		const item: CurrencyItem = { id, name, code, symbol: stringField(rec.symbol) || code };
		if (typeof rec.rate === "string") item.rate = rec.rate;
		if (typeof rec.in_use === "boolean") item.in_use = rec.in_use;
		out.push(item);
	}
	return out;
}

const NAMED_PERIODS: Record<string, CycleFrequency> = {
	daily: { cycle: 1, frequency: 1 },
	weekly: { cycle: 2, frequency: 1 },
	biweekly: { cycle: 2, frequency: 2 },
	monthly: { cycle: 3, frequency: 1 },
	quarterly: { cycle: 3, frequency: 3 },
	semiannually: { cycle: 3, frequency: 6 },
	yearly: { cycle: 4, frequency: 1 },
};

const EVERY_PERIOD = /^every\s+(\d+)\s+(days?|weeks?|months?|years?)$/i;

const UNIT_CYCLE: Record<string, Cycle> = {
	day: 1,
	days: 1,
	week: 2,
	weeks: 2,
	month: 3,
	months: 3,
	year: 4,
	years: 4,
};

export function parseBillingPeriod(input: {
	billing_period?: string | undefined;
	cycle?: number | undefined;
	frequency?: number | undefined;
}): CycleFrequency {
	if (input.billing_period !== undefined) {
		return parseBillingPeriodString(input.billing_period);
	}
	if (input.cycle === undefined && input.frequency === undefined) {
		return { cycle: 3, frequency: 1 };
	}
	return readCycleFrequency(input.cycle ?? 3, input.frequency ?? 1);
}

export function parseBillingPeriodOptional(input: {
	billing_period?: string | undefined;
	cycle?: number | undefined;
	frequency?: number | undefined;
}): CycleFrequency | null {
	if (
		input.billing_period === undefined &&
		input.cycle === undefined &&
		input.frequency === undefined
	) {
		return null;
	}
	return parseBillingPeriod(input);
}

export function parseBillingPeriodString(raw: string): CycleFrequency {
	const named = NAMED_PERIODS[raw.trim().toLowerCase()];
	if (named) return named;
	const every = EVERY_PERIOD.exec(raw.trim());
	if (every) {
		const frequency = Number(every[1]);
		const unit = (every[2] ?? "").toLowerCase();
		const cycle = UNIT_CYCLE[unit];
		if (!cycle || !Number.isInteger(frequency) || frequency < 1) {
			throw new WallosError("Invalid billing period", billingPeriodHelp(raw));
		}
		return { cycle, frequency };
	}
	throw new WallosError("Invalid billing period", billingPeriodHelp(raw));
}

function billingPeriodHelp(raw: string): string {
	return (
		`"${raw}" is not a billing period. Use daily, weekly, biweekly, monthly, quarterly, ` +
		`semiannually, yearly, or "every N days|weeks|months|years", or pass cycle (1–4) and frequency.`
	);
}

function readCycleFrequency(cycle: number, frequency: number): CycleFrequency {
	if (cycle !== 1 && cycle !== 2 && cycle !== 3 && cycle !== 4) {
		throw new WallosError(
			"Invalid cycle",
			"cycle must be 1 (days), 2 (weeks), 3 (months), or 4 (years).",
		);
	}
	if (!Number.isInteger(frequency) || frequency < 1) {
		throw new WallosError("Invalid frequency", "frequency must be a positive integer.");
	}
	return { cycle, frequency };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type Ymd = { y: number; m: number; d: number };

export function parseIsoDate(iso: string): Ymd {
	const match = ISO_DATE.exec(iso);
	if (!match) {
		throw new WallosError("Invalid date", `expected YYYY-MM-DD, got "${iso}"`);
	}
	const y = Number(match[1]);
	const m = Number(match[2]);
	const d = Number(match[3]);
	if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
		throw new WallosError("Invalid date", `"${iso}" is not a calendar date`);
	}
	return { y, m, d };
}

export function formatIsoDate(parts: Ymd): string {
	const y = String(parts.y).padStart(4, "0");
	const m = String(parts.m).padStart(2, "0");
	const d = String(parts.d).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function utcToday(now = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

// Wallos reads and writes calendar dates in the instance's own timezone, and
// v5 exposes that timezone nowhere in the API. A Worker runs in UTC, so a
// caller east or west of it gets the wrong day for part of every day — 00:30 in
// Tokyo is still yesterday in UTC. A caller that knows the zone passes it.
export function todayIn(timeZone?: string, now = Date.now()): string {
	if (!timeZone) return utcToday(now);
	try {
		// en-CA formats as YYYY-MM-DD, which is the wire format Wallos wants.
		return new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date(now));
	} catch {
		throw new WallosError(
			"Unknown timezone",
			`"${timeZone}" is not an IANA timezone name such as Asia/Tokyo or Europe/Berlin.`,
		);
	}
}

function isLeap(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
	const lengths = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return lengths[month - 1] ?? 0;
}

function compareIso(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

export function addPeriod(iso: string, cycle: Cycle, frequency: number, times = 1): string {
	const steps = frequency * times;
	if (cycle === 1) return addDays(iso, steps);
	if (cycle === 2) return addDays(iso, steps * 7);
	if (cycle === 3) return addMonths(iso, steps);
	return addMonths(iso, steps * 12);
}

function addDays(iso: string, days: number): string {
	const { y, m, d } = parseIsoDate(iso);
	// Calendar days in UTC so a local offset cannot slide the date across midnight.
	const utc = Date.UTC(y, m - 1, d + days);
	return new Date(utc).toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
	const { y, m, d } = parseIsoDate(iso);
	const index = m - 1 + months;
	const year = y + Math.floor(index / 12);
	const month = ((index % 12) + 12) % 12;
	const last = daysInMonth(year, month + 1);
	return formatIsoDate({ y: year, m: month + 1, d: Math.min(d, last) });
}

// Wallos rejects a next payment in the past. Today is accepted. A start date
// already on or after today is used as-is; otherwise whole periods are added
// until the result is not in the past. Month lengths clamp (31 Jan → 28 Feb).
export function deriveNextPayment(
	startDate: string,
	cycle: Cycle,
	frequency: number,
	today = utcToday(),
): string {
	const start = parseIsoDate(startDate);
	const now = parseIsoDate(today);
	if (compareIso(startDate, today) >= 0) return startDate;
	// Skip ahead before walking. A daily subscription started decades ago is
	// thousands of periods old, and stepping one period at a time from the start
	// date costs work proportional to the subscription's age. The estimate uses
	// the longest a period can be, so it always lands at or before the answer
	// and the walk still decides it.
	const days = Math.floor(
		(Date.UTC(now.y, now.m - 1, now.d) - Date.UTC(start.y, start.m - 1, start.d)) / 86_400_000,
	);
	const longestPeriod = frequency * (cycle === 1 ? 1 : cycle === 2 ? 7 : cycle === 3 ? 31 : 366);
	const estimate = Math.max(0, Math.floor(days / longestPeriod) - 1);
	// Count periods from the original start day, so a 31st stays a 31st on long
	// months and becomes the last day of a short one.
	for (let n = estimate; n <= estimate + 1_000; n++) {
		const current = addPeriod(startDate, cycle, frequency, n);
		if (compareIso(current, today) >= 0) return current;
	}
	throw new WallosError(
		"Could not derive next_payment",
		"advancing the start date never reached today; pass next_payment explicitly",
	);
}

function findByName(items: NamedItem[], name: string): NamedItem[] {
	const needle = name.trim().toLowerCase();
	return items.filter((item) => item.name.toLowerCase() === needle);
}

function findByCode(items: CurrencyItem[], code: string): CurrencyItem[] {
	const needle = code.trim().toLowerCase();
	return items.filter((item) => item.code.toLowerCase() === needle);
}

function availableNames(items: NamedItem[]): string {
	if (items.length === 0) return "(none)";
	return items.map((item) => item.name).join(", ");
}

function availableCodes(items: CurrencyItem[]): string {
	if (items.length === 0) return "(none)";
	return items.map((item) => item.code).join(", ");
}

export function currencyLabel(code: string): { name: string; symbol: string } {
	const upper = code.trim().toUpperCase();
	try {
		const name = new Intl.DisplayNames(["en"], { type: "currency" }).of(upper);
		const symbol =
			new Intl.NumberFormat("en", { style: "currency", currency: upper })
				.formatToParts(0)
				.find((part) => part.type === "currency")?.value ?? upper;
		return { name: name ?? upper, symbol };
	} catch {
		return { name: upper, symbol: upper };
	}
}

function needsMasterData(refs: NameRefs, requireCurrency: boolean): boolean {
	return (
		(refs.category_id === undefined && refs.category_name !== undefined) ||
		(refs.payment_method_id === undefined && refs.payment_method_name !== undefined) ||
		(refs.payer_user_id === undefined && refs.payer_name !== undefined) ||
		(refs.currency_id === undefined && (refs.currency_code !== undefined || requireCurrency))
	);
}

export async function resolveSubscriptionRefs(
	client: WallosClient,
	refs: NameRefs,
	requireCurrency: boolean,
): Promise<ResolvedIds> {
	const createMissing = refs.create_missing !== false;
	const master = needsMasterData(refs, requireCurrency) ? await client.getMasterData() : null;
	const resolved: ResolvedIds = {};
	const categoryId = await pickNamed(refs.category_id, refs.category_name, master?.categories, {
		kind: "category",
		createMissing,
		create: (name) => client.addCategory(name),
	});
	const paymentMethodId = await pickNamed(
		refs.payment_method_id,
		refs.payment_method_name,
		master?.payment_methods,
		{ kind: "payment method", createMissing, create: (name) => client.addPaymentMethod(name) },
	);
	const payerUserId = await pickNamed(refs.payer_user_id, refs.payer_name, master?.household, {
		kind: "household member",
		createMissing,
		create: (name) => client.addHouseholdMember(name),
	});
	if (categoryId !== undefined) resolved.category_id = categoryId;
	if (paymentMethodId !== undefined) resolved.payment_method_id = paymentMethodId;
	if (payerUserId !== undefined) resolved.payer_user_id = payerUserId;
	if (refs.currency_id !== undefined) {
		resolved.currency_id = refs.currency_id;
	} else if (refs.currency_code !== undefined && master) {
		resolved.currency_id = await resolveCurrency(client, master, refs.currency_code, createMissing);
	} else if (requireCurrency && master) {
		resolved.currency_id = master.main_currency;
	}
	return resolved;
}

async function pickNamed(
	explicit: number | undefined,
	name: string | undefined,
	items: NamedItem[] | undefined,
	opts: { kind: string; createMissing: boolean; create: (name: string) => Promise<number> },
): Promise<number | undefined> {
	if (explicit !== undefined) return explicit;
	if (name === undefined || !items) return undefined;
	return resolveOrCreate({
		kind: opts.kind,
		name,
		items,
		createMissing: opts.createMissing,
		create: () => opts.create(name),
	});
}

async function resolveOrCreate(opts: {
	kind: string;
	name: string;
	items: NamedItem[];
	createMissing: boolean;
	create: () => Promise<number>;
}): Promise<number> {
	const matches = findByName(opts.items, opts.name);
	if (matches.length === 1) {
		const hit = matches[0];
		if (hit) return hit.id;
	}
	if (matches.length > 1) {
		throw new WallosError(
			`Ambiguous ${opts.kind}`,
			`"${opts.name}" matches more than one entry: ${availableNames(matches)}`,
		);
	}
	if (!opts.createMissing) {
		throw new WallosError(
			`Unknown ${opts.kind}`,
			`"${opts.name}" is not on this instance. Available: ${availableNames(opts.items)}`,
		);
	}
	return opts.create();
}

async function resolveCurrency(
	client: WallosClient,
	master: MasterData,
	code: string,
	createMissing: boolean,
): Promise<number> {
	const matches = findByCode(master.currencies, code);
	if (matches.length === 1) {
		const hit = matches[0];
		if (hit) return hit.id;
	}
	if (matches.length > 1) {
		throw new WallosError(
			"Ambiguous currency",
			`"${code}" matches more than one entry: ${availableCodes(matches)}`,
		);
	}
	if (!createMissing) {
		throw new WallosError(
			"Unknown currency",
			`"${code}" is not on this instance. Available: ${availableCodes(master.currencies)}`,
		);
	}
	const label = currencyLabel(code);
	return client.addCurrency({
		name: label.name,
		symbol: label.symbol,
		code: code.trim().toUpperCase(),
		rate: 1,
	});
}

export class WallosClient {
	constructor(
		readonly baseUrl: string,
		readonly apiKey: string,
	) {}

	async getUser(): Promise<Record<string, unknown>> {
		const body = await this.json("api/users/get_user.php");
		const user = body.user;
		if (!user || typeof user !== "object") {
			throw new WallosError("Invalid user", "get_user returned no user object");
		}
		return redactSecrets(user) as Record<string, unknown>;
	}

	async getVersion(): Promise<{ version: string; version_number: string }> {
		const body = await this.json("api/status/version.php");
		return {
			version: stringField(body.version) || stringField(body.version_number) || "unknown",
			version_number: stringField(body.version_number),
		};
	}

	async getSubscriptions(
		filters: Record<string, FormValue> = {},
	): Promise<Record<string, unknown>> {
		return this.json("api/subscriptions/get_subscriptions.php", filters);
	}

	async getSubscription(id: number, convertCurrency = false): Promise<Record<string, unknown>> {
		return this.json("api/subscriptions/get_subscription.php", {
			id,
			...(convertCurrency ? { convert_currency: "true" } : {}),
		});
	}

	async setSubscription(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/subscriptions/set_subscriptions.php", fields);
	}

	async getMonthlyCost(month: number, year: number): Promise<Record<string, unknown>> {
		return this.json("api/subscriptions/get_monthly_cost.php", { month, year });
	}

	async getIcalFeed(convertCurrency = false): Promise<string> {
		const raw = await this.request("api/subscriptions/get_ical_feed.php", {
			...(convertCurrency ? { convert_currency: "true" } : {}),
		});
		if (raw.contentType.includes("text/calendar") || raw.text.startsWith("BEGIN:VCALENDAR")) {
			return raw.text;
		}
		parseWallosJson(raw.text, this.apiKey);
		throw new WallosError("Unexpected iCal response", "the instance did not return a calendar");
	}

	async getPeriodBudget(referenceDate?: string): Promise<Record<string, unknown>> {
		return this.json("api/subscriptions/get_period_budget.php", {
			...(referenceDate ? { reference_date: referenceDate } : {}),
		});
	}

	// Wallos stores the monthly budget on the user and the period budget beside
	// it; one call writes whichever fields were given.
	async setBudget(fields: {
		monthly_budget?: number | undefined;
		period_budget?: number | undefined;
		budget_period_type?: string | undefined;
		budget_period_anchor_date?: string | undefined;
	}): Promise<Record<string, unknown>> {
		return this.json("api/users/set_budget.php", { ...fields });
	}

	async getMasterData(): Promise<MasterData> {
		const [categories, currencies, methods, household] = await Promise.all([
			this.json("api/categories/get_categories.php"),
			this.json("api/currencies/get_currencies.php"),
			this.json("api/payment_methods/get_payment_methods.php"),
			this.json("api/household/get_household.php"),
		]);
		return {
			categories: asItems(categories.categories),
			currencies: asCurrencies(currencies.currencies),
			payment_methods: asItems(methods.payment_methods),
			household: asItems(household.household),
			main_currency: numberField(currencies.main_currency),
		};
	}

	async addCategory(name: string): Promise<number> {
		const body = await this.json("api/categories/set_categories.php", { action: "add", name });
		return createdId(body, "categoryId", "category");
	}

	async setCategory(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/categories/set_categories.php", fields);
	}

	async addPaymentMethod(name: string, extra: Record<string, FormValue> = {}): Promise<number> {
		const body = await this.json("api/payment_methods/set_payment_methods.php", {
			action: "add",
			name,
			...extra,
		});
		return createdId(body, "paymentId", "payment method");
	}

	async setPaymentMethod(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/payment_methods/set_payment_methods.php", fields);
	}

	async addHouseholdMember(name: string, email?: string): Promise<number> {
		const body = await this.json("api/household/set_household.php", {
			action: "add",
			name,
			...(email !== undefined ? { email } : {}),
		});
		return createdId(body, "memberId", "household member");
	}

	async setHousehold(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/household/set_household.php", fields);
	}

	async addCurrency(input: {
		name: string;
		symbol: string;
		code: string;
		rate?: number;
	}): Promise<number> {
		const body = await this.json("api/currencies/set_currencies.php", {
			action: "add",
			name: input.name,
			symbol: input.symbol,
			code: input.code,
			...(input.rate !== undefined ? { rate: input.rate } : {}),
		});
		return createdId(body, "currencyId", "currency");
	}

	async setCurrency(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/currencies/set_currencies.php", fields);
	}

	async getSettings(): Promise<Record<string, unknown>> {
		return this.json("api/settings/get_settings.php");
	}

	async setSettings(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/settings/set_settings.php", fields);
	}

	async getNotificationSettings(): Promise<Record<string, unknown>> {
		return redactSecrets(
			await this.json("api/notifications/get_notification_settings.php"),
		) as Record<string, unknown>;
	}

	async getFixer(): Promise<Record<string, unknown>> {
		return redactSecrets(await this.json("api/fixer/get_fixer.php")) as Record<string, unknown>;
	}

	async setFixer(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/fixer/set_fixer.php", fields);
	}

	async getAdminSettings(): Promise<Record<string, unknown>> {
		return redactSecrets(await this.json("api/admin/get_admin_settings.php")) as Record<
			string,
			unknown
		>;
	}

	async setAdminSettings(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/admin/set_admin_settings.php", fields);
	}

	async getOidcSettings(): Promise<Record<string, unknown>> {
		return redactSecrets(await this.json("api/admin/get_oidc_settings.php")) as Record<
			string,
			unknown
		>;
	}

	async setOidcSettings(fields: Record<string, FormValue>): Promise<Record<string, unknown>> {
		return this.json("api/admin/set_oidc_settings.php", fields);
	}

	async setDisablePasswordLogin(disable: boolean): Promise<Record<string, unknown>> {
		return this.json("api/admin/set_disable_password_login.php", { disable: disable ? "1" : "0" });
	}

	async json(
		path: string,
		fields: Record<string, FormValue> = {},
	): Promise<Record<string, unknown>> {
		const raw = await this.request(path, fields);
		return parseWallosJson(raw.text, this.apiKey);
	}

	async request(
		path: string,
		fields: Record<string, FormValue> = {},
	): Promise<{ status: number; contentType: string; text: string }> {
		const url = `${this.baseUrl}/${path}`;
		// The key travels in the form body. A query string ends up in access logs.
		const body = encodeForm({ ...fields, api_key: this.apiKey });
		let resp: Response;
		try {
			resp = await fetch(url, {
				method: "POST",
				// Redirects are refused rather than followed. 307 and 308 preserve the
				// method and the body, so an instance that answers one — because it
				// was misconfigured, or because whoever runs it wants the key — would
				// have this POST replayed, api_key included, at whatever host the
				// Location names. The allowlist only ever saw the first URL.
				redirect: "manual",
				signal: AbortSignal.timeout(WALLOS_TIMEOUT_MS),
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new WallosError("Wallos request failed", redactSecret(message, this.apiKey));
		}
		if (resp.status >= 300 && resp.status < 400) {
			throw new WallosError(
				"Wallos redirected the request",
				`${url} answered ${resp.status}. The base URL should be the address the instance serves on, with the scheme it actually uses.`,
			);
		}
		const text = redactSecret(await readBoundedText(resp.body, MAX_RESPONSE_BYTES), this.apiKey);
		return {
			status: resp.status,
			contentType: resp.headers.get("content-type") ?? "",
			text,
		};
	}
}

function createdId(body: Record<string, unknown>, field: string, kind: string): number {
	const id = numberField(body[field], Number.NaN);
	if (!Number.isFinite(id)) {
		throw new WallosError(`Failed to create ${kind}`, "the instance did not return an id");
	}
	return id;
}
