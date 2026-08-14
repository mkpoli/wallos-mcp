import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentByName } from "agents";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import {
	accountIdFromProps,
	BodyTooLarge,
	hasPeriodBudget,
	type Props,
	readBoundedBody,
	redactSecret,
	redactSecrets,
} from "./utils";
import {
	type CycleFrequency,
	deriveNextPayment,
	type FormValue,
	parseBillingPeriod,
	parseBillingPeriodOptional,
	type ResolvedIds,
	resolveSubscriptionRefs,
	todayIn,
	WallosClient,
	WallosError,
} from "./wallos";
import { WallosHandler } from "./wallos-handler";

const ACCOUNT_HEADER = "x-wallos-mcp-account";
const PROPS_HEADER = "x-partykit-props";
const MCP_MESSAGE_LIMIT = 4 * 1024 * 1024;
const MAX_TOOL_CHARS = 80_000;

const sortValues = [
	"name",
	"id",
	"next_payment",
	"price",
	"payer_user_id",
	"category_id",
	"payment_method_id",
	"inactive",
	"alphanumeric",
] as const;

const nameRefFields = {
	category_id: z.number().int().positive().optional(),
	category_name: z.string().optional().describe("Resolved against the instance's categories"),
	payment_method_id: z.number().int().positive().optional(),
	payment_method_name: z.string().optional(),
	payer_user_id: z.number().int().positive().optional(),
	payer_name: z.string().optional().describe("Household member who pays"),
	currency_id: z.number().int().positive().optional(),
	currency_code: z.string().optional().describe("ISO 4217 code, e.g. EUR"),
	create_missing: z
		.boolean()
		.default(true)
		.describe("Create a named category, payment method, member, or currency when it is missing"),
};

const billingFields = {
	billing_period: z
		.string()
		.optional()
		.describe(
			'daily, weekly, biweekly, monthly, quarterly, semiannually, yearly, or "every N days|weeks|months|years"',
		),
	cycle: z.number().int().min(1).max(4).optional().describe("1 days, 2 weeks, 3 months, 4 years"),
	frequency: z.number().int().positive().optional().describe("Multiplier for cycle"),
};

export class WallosMCP extends McpAgent<Env, Record<string, never>, Props> {
	// The workspace SDK and the copy nested in `agents` are separate
	// declarations of McpServer, so the field does not unify with the base.
	// @ts-expect-error distinct McpServer package identities
	server = new McpServer({
		name: "Wallos MCP",
		version: "0.1.0",
	});

	private callerAccount: string | null = null;
	private periodBudget = false;
	private adminTools = false;

	override async fetch(request: Request): Promise<Response> {
		const account = request.headers.get(ACCOUNT_HEADER);
		if (account) {
			const owner = await this.ctx.storage.get<string>("owner");
			if (owner === undefined) {
				await this.ctx.storage.put("owner", account);
			} else if (owner !== account) {
				return new Response("this MCP session belongs to a different Wallos account", {
					status: 403,
				});
			}
			this.callerAccount = account;
		}
		return super.fetch(request);
	}

	async isOwnedBy(account: string): Promise<boolean> {
		const owner = await this.ctx.storage.get<string>("owner");
		return owner === undefined || owner === account;
	}

	private get grantProps(): Props {
		if (!this.props) throw new Error("missing auth props on MCP session");
		return this.props;
	}

	private async ownerProps(): Promise<Props> {
		const owner = await this.ctx.storage.get<string>("owner");
		const props = this.grantProps;
		const id = accountIdFromProps(props);
		if (owner !== undefined && id !== owner) {
			throw new Error("this MCP session belongs to a different Wallos account");
		}
		return props;
	}

	private async assertSessionOwner(): Promise<void> {
		const props = this.grantProps;
		const caller = this.callerAccount ?? accountIdFromProps(props);
		const owner = await this.ctx.storage.get<string>("owner");
		if (owner === undefined) {
			await this.ctx.storage.put("owner", caller);
			return;
		}
		if (owner !== caller) {
			throw new Error("this MCP session belongs to a different Wallos account");
		}
		if (accountIdFromProps(props) !== owner) {
			throw new Error("this MCP session belongs to a different Wallos account");
		}
	}

	private async assertWithinRate(): Promise<void> {
		const limiter = this.env.RATE_LIMITER;
		if (!limiter) return;
		const props = await this.ownerProps();
		const { success } = await limiter.limit({ key: accountIdFromProps(props) });
		if (!success) {
			throw new Error("rate limit reached for this account; retry shortly");
		}
	}

	private text(data: unknown) {
		let payload = JSON.stringify(redactSecrets(data), null, 2);
		if (payload.length > MAX_TOOL_CHARS) {
			payload = `${payload.slice(0, MAX_TOOL_CHARS)}\n… truncated`;
		}
		return { content: [{ type: "text" as const, text: payload }] };
	}

	private async run(work: (client: WallosClient, props: Props) => Promise<unknown>) {
		await this.assertSessionOwner();
		await this.assertWithinRate();
		const props = await this.ownerProps();
		try {
			return this.text(await work(new WallosClient(props.baseUrl, props.apiKey), props));
		} catch (error: unknown) {
			if (error instanceof WallosError) {
				throw new Error(redactSecret(error.message, props.apiKey));
			}
			if (error instanceof Error) {
				throw new Error(redactSecret(error.message, props.apiKey));
			}
			throw error;
		}
	}

	async init() {
		const props = await this.ownerProps();
		this.adminTools = String(this.env.ADMIN_TOOLS) === "1";

		let version = props.version;
		try {
			const live = await new WallosClient(props.baseUrl, props.apiKey).getVersion();
			version = live.version;
		} catch {
			// Props carry the version from sign-in when the live read fails.
		}
		this.periodBudget = hasPeriodBudget(version);

		// The var says the operator wants the administration tools; the bound key
		// decides whether they would do anything. Wallos exposes no admin flag on
		// the user, so the cheapest honest test is an admin read: a key without
		// the rights is refused, and listing tools that can only fail wastes the
		// assistant's attempt and the user's time.
		if (this.adminTools) {
			this.adminTools = await new WallosClient(props.baseUrl, props.apiKey)
				.getAdminSettings()
				.then(() => true)
				.catch(() => false);
		}

		this.registerSessionTools(props, version);
		this.registerSubscriptionTools(props);
		this.registerMasterDataTools(props);
		this.registerSettingsTools(props);
		if (this.adminTools) this.registerAdminTools(props);
	}

	private registerSessionTools(props: Props, version: string) {
		const gated = this.periodBudget ? ["get_period_budget"] : [];
		const admin = this.adminTools
			? [
					"get_admin_settings",
					"update_admin_settings",
					"get_oidc_settings",
					"update_oidc_settings",
					"set_password_login_disabled",
				]
			: [];

		this.server.tool(
			"whoami",
			`Show which Wallos instance and user this connection is bound to (${props.username} on ${props.baseUrl})`,
			{},
			async () =>
				this.run(async (client) => {
					const [user, live] = await Promise.all([
						client.getUser(),
						client.getVersion().catch(() => ({ version, version_number: "" })),
					]);
					return {
						baseUrl: props.baseUrl,
						user: {
							id: user.id,
							username: user.username,
							email: user.email,
							main_currency: user.main_currency,
							language: user.language,
							budget: user.budget,
						},
						version: live.version,
						version_gated_tools: this.periodBudget ? gated : [],
						admin_tools: admin,
					};
				}),
		);
	}

	private registerSubscriptionTools(props: Props) {
		this.server.tool(
			"list_subscriptions",
			`List subscriptions on ${props.username}'s Wallos, with the instance's own filters`,
			{
				member: z
					.array(z.number().int().positive())
					.optional()
					.describe("Household member ids to filter by"),
				category: z.number().int().positive().optional(),
				payment_method: z.number().int().positive().optional(),
				state: z.enum(["active", "inactive"]).optional(),
				sort: z.enum(sortValues).optional(),
				disabled_to_bottom: z.boolean().optional(),
				convert_currency: z.boolean().optional(),
				all_user_subscriptions: z
					.boolean()
					.optional()
					.describe("Admin only: list every user's subscriptions"),
			},
			async (args) => this.run((client) => client.getSubscriptions(listSubscriptionFields(args))),
		);

		this.server.tool(
			"get_subscription",
			`Read one subscription from ${props.username}'s Wallos by id`,
			{
				id: z.number().int().positive(),
				convert_currency: z.boolean().optional(),
			},
			async ({ id, convert_currency }) =>
				this.run((client) => client.getSubscription(id, convert_currency === true)),
		);

		this.server.tool(
			"create_subscription",
			`Add a subscription on ${props.username}'s Wallos. Names resolve to ids; missing names are created unless create_missing is false. start_date defaults to today; next_payment is derived when omitted.`,
			{
				name: z.string(),
				price: z.number(),
				...nameRefFields,
				...billingFields,
				start_date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
				next_payment: z
					.string()
					.optional()
					.describe("YYYY-MM-DD; derived from start_date when omitted"),
				auto_renew: z.boolean().optional(),
				notes: z.string().optional(),
				url: z.string().optional(),
				logo_url: z.string().optional().describe("Wallos fetches this itself"),
				notify: z.boolean().optional(),
				notify_days_before: z.number().int().optional(),
				inactive: z.boolean().optional(),
				cancellation_date: z.string().optional(),
				replacement_subscription_id: z.number().int().positive().optional(),
				timezone: z
					.string()
					.optional()
					.describe(
						"IANA name, e.g. Asia/Tokyo. Decides what today means for start_date and the derived next_payment; UTC otherwise",
					),
			},
			async (args) =>
				this.run(async (client) => {
					const ids = await resolveSubscriptionRefs(client, args, true);
					const period = parseBillingPeriod(args);
					const today = todayIn(args.timezone);
					const start = args.start_date ?? today;
					const next =
						args.next_payment ?? deriveNextPayment(start, period.cycle, period.frequency, today);
					return client.setSubscription(
						subscriptionWriteFields("add", args, ids, period, start, next),
					);
				}),
		);

		this.server.tool(
			"update_subscription",
			`Edit a subscription on ${props.username}'s Wallos. Omitted fields stay as they are. An explicit *_id wins over the matching name.`,
			{
				id: z.number().int().positive(),
				name: z.string().optional(),
				price: z.number().optional(),
				...nameRefFields,
				...billingFields,
				start_date: z.string().optional(),
				next_payment: z.string().optional(),
				auto_renew: z.boolean().optional(),
				notes: z.string().optional(),
				url: z.string().optional(),
				logo_url: z.string().optional(),
				notify: z.boolean().optional(),
				notify_days_before: z.number().int().optional(),
				inactive: z.boolean().optional(),
				cancellation_date: z.string().optional(),
				replacement_subscription_id: z.number().int().positive().optional(),
			},
			async (args) =>
				this.run(async (client) => {
					const ids = await resolveSubscriptionRefs(client, args, false);
					const period = parseBillingPeriodOptional(args);
					let next = args.next_payment;
					if (next === undefined && args.start_date !== undefined && period) {
						next = deriveNextPayment(args.start_date, period.cycle, period.frequency);
					}
					return client.setSubscription(
						subscriptionWriteFields("edit", args, ids, period, args.start_date, next),
					);
				}),
		);

		this.server.tool(
			"delete_subscription",
			`Delete a subscription on ${props.username}'s Wallos. The row is removed outright.`,
			{
				id: z.number().int().positive(),
				confirm: z.literal(true).describe("Required; deletion is permanent"),
			},
			async ({ id }) => this.run((client) => client.setSubscription({ action: "delete", id })),
		);

		this.server.tool(
			"get_monthly_cost",
			`Total subscription cost for a calendar month on ${props.username}'s Wallos`,
			{
				month: z.number().int().min(1).max(12).optional(),
				year: z.number().int().min(1970).max(2100).optional(),
				timezone: z
					.string()
					.optional()
					.describe("IANA name deciding which month is the current one; UTC otherwise"),
			},
			async ({ month, year, timezone }) =>
				this.run((client) => {
					const today = todayIn(timezone);
					return client.getMonthlyCost(
						month ?? Number(today.slice(5, 7)),
						year ?? Number(today.slice(0, 4)),
					);
				}),
		);

		this.server.tool(
			"get_ical_feed",
			`iCalendar feed of active subscriptions on ${props.username}'s Wallos. Prices come back in each subscription's own currency: Wallos accepts convert_currency here and then builds the calendar from an unconverted second read, through 5.4.2 — use list_subscriptions with convert_currency for comparable amounts.`,
			{
				convert_currency: z
					.boolean()
					.optional()
					.describe("Passed through; Wallos currently ignores it for this endpoint"),
			},
			async ({ convert_currency }) =>
				this.run(async (client) => ({
					ical: await client.getIcalFeed(convert_currency === true),
				})),
		);

		if (this.periodBudget) {
			this.server.tool(
				"get_period_budget",
				`Period budget versus projected spend on ${props.username}'s Wallos (Wallos 5.3+)`,
				{
					reference_date: z
						.string()
						.optional()
						.describe("YYYY-MM-DD to evaluate; defaults to today on the instance"),
				},
				async ({ reference_date }) => this.run((client) => client.getPeriodBudget(reference_date)),
			);

			this.server.tool(
				"update_budget",
				`Set the monthly or period budget on ${props.username}'s Wallos (Wallos 5.3+). At least one field is required; period budgeting also needs a period type and an anchor date to evaluate against.`,
				{
					monthly_budget: z.number().nonnegative().optional(),
					period_budget: z.number().nonnegative().optional(),
					budget_period_type: z.enum(["weekly", "fortnightly", "monthly"]).optional(),
					budget_period_anchor_date: z
						.string()
						.optional()
						.describe("YYYY-MM-DD the period counts from"),
				},
				async (args) => {
					if (Object.values(args).every((value) => value === undefined)) {
						throw new WallosError(
							"Nothing to set",
							"Pass monthly_budget, period_budget, budget_period_type, or budget_period_anchor_date.",
						);
					}
					// Wallos rewrites the whole period configuration whenever any part of
					// it arrives, defaulting what is missing. Changing an amount alone
					// would move a weekly budget anchored in the past to monthly, anchored
					// today, and report success. The three travel together or not at all.
					const period = [
						args.period_budget,
						args.budget_period_type,
						args.budget_period_anchor_date,
					];
					if (period.some((v) => v !== undefined) && period.some((v) => v === undefined)) {
						throw new WallosError(
							"Incomplete period budget",
							"period_budget, budget_period_type and budget_period_anchor_date are stored as one setting: send all three, or read the current values with get_period_budget and pass them back unchanged.",
						);
					}
					return this.run((client) => client.setBudget(args));
				},
			);
		}
	}

	private registerMasterDataTools(props: Props) {
		this.server.tool(
			"get_master_data",
			`Categories, currencies, payment methods and household members on ${props.username}'s Wallos, together — every subscription write needs ids from these lists`,
			{},
			async () => this.run((client) => client.getMasterData()),
		);

		this.server.tool(
			"create_category",
			`Add a category on ${props.username}'s Wallos`,
			{ name: z.string() },
			async ({ name }) =>
				this.run(async (client) => {
					const id = await client.addCategory(name);
					return { categoryId: id };
				}),
		);
		this.server.tool(
			"update_category",
			`Rename a category on ${props.username}'s Wallos`,
			{ id: z.number().int().positive(), name: z.string() },
			async ({ id, name }) =>
				this.run((client) => client.setCategory({ action: "edit", id, name })),
		);
		this.server.tool(
			"delete_category",
			`Delete a category on ${props.username}'s Wallos. Subscriptions that still reference it lose that category.`,
			{ id: z.number().int().positive(), confirm: z.literal(true) },
			async ({ id }) => this.run((client) => client.setCategory({ action: "delete", id })),
		);

		this.server.tool(
			"create_payment_method",
			`Add a payment method on ${props.username}'s Wallos`,
			{
				name: z.string(),
				enabled: z.boolean().optional(),
				icon_url: z.string().optional(),
			},
			async ({ name, enabled, icon_url }) =>
				this.run(async (client) => {
					const extra: Record<string, FormValue> = {};
					if (enabled !== undefined) extra.enabled = enabled ? "1" : "0";
					if (icon_url !== undefined) extra.icon_url = icon_url;
					const id = await client.addPaymentMethod(name, extra);
					return { paymentId: id };
				}),
		);
		this.server.tool(
			"update_payment_method",
			`Edit a payment method on ${props.username}'s Wallos`,
			{
				id: z.number().int().positive(),
				name: z.string().optional(),
				enabled: z.boolean().optional(),
				icon_url: z.string().optional(),
			},
			async ({ id, name, enabled, icon_url }) =>
				this.run((client) =>
					client.setPaymentMethod({
						action: "edit",
						id,
						...(name !== undefined ? { name } : {}),
						...(enabled !== undefined ? { enabled: enabled ? "1" : "0" } : {}),
						...(icon_url !== undefined ? { icon_url } : {}),
					}),
				),
		);
		this.server.tool(
			"delete_payment_method",
			`Delete a payment method on ${props.username}'s Wallos. Subscriptions that still reference it lose that method.`,
			{ id: z.number().int().positive(), confirm: z.literal(true) },
			async ({ id }) => this.run((client) => client.setPaymentMethod({ action: "delete", id })),
		);

		this.server.tool(
			"create_household_member",
			`Add a household member on ${props.username}'s Wallos`,
			{ name: z.string(), email: z.string().optional() },
			async ({ name, email }) =>
				this.run(async (client) => {
					const id = await client.addHouseholdMember(name, email);
					return { memberId: id };
				}),
		);
		this.server.tool(
			"update_household_member",
			`Edit a household member on ${props.username}'s Wallos`,
			{
				id: z.number().int().positive(),
				name: z.string().optional(),
				email: z.string().optional(),
			},
			async ({ id, name, email }) =>
				this.run((client) =>
					client.setHousehold({
						action: "edit",
						id,
						...(name !== undefined ? { name } : {}),
						...(email !== undefined ? { email } : {}),
					}),
				),
		);
		this.server.tool(
			"delete_household_member",
			`Delete a household member on ${props.username}'s Wallos`,
			{ id: z.number().int().positive(), confirm: z.literal(true) },
			async ({ id }) => this.run((client) => client.setHousehold({ action: "delete", id })),
		);

		this.server.tool(
			"create_currency",
			`Add a currency on ${props.username}'s Wallos`,
			{
				name: z.string(),
				symbol: z.string(),
				code: z.string(),
				rate: z.number().optional(),
			},
			async ({ name, symbol, code, rate }) =>
				this.run(async (client) => {
					const id = await client.addCurrency({
						name,
						symbol,
						code,
						...(rate !== undefined ? { rate } : {}),
					});
					return { currencyId: id };
				}),
		);
		this.server.tool(
			"update_currency",
			`Edit a currency on ${props.username}'s Wallos`,
			{
				id: z.number().int().positive(),
				name: z.string().optional(),
				symbol: z.string().optional(),
				code: z.string().optional(),
				rate: z.number().optional(),
			},
			async ({ id, name, symbol, code, rate }) =>
				this.run((client) =>
					client.setCurrency({
						action: "edit",
						id,
						...(name !== undefined ? { name } : {}),
						...(symbol !== undefined ? { symbol } : {}),
						...(code !== undefined ? { code } : {}),
						...(rate !== undefined ? { rate } : {}),
					}),
				),
		);
		this.server.tool(
			"delete_currency",
			`Delete a currency on ${props.username}'s Wallos`,
			{ id: z.number().int().positive(), confirm: z.literal(true) },
			async ({ id }) => this.run((client) => client.setCurrency({ action: "delete", id })),
		);
	}

	private registerSettingsTools(props: Props) {
		this.server.tool(
			"get_settings",
			`Read ${props.username}'s Wallos display settings`,
			{},
			async () => this.run((client) => client.getSettings()),
		);

		this.server.tool(
			"update_settings",
			`Update ${props.username}'s Wallos display settings. Only the fields you pass are written.`,
			{
				dark_theme: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
				color_theme: z.enum(["blue", "green", "red", "yellow", "purple", "custom"]).optional(),
				monthly_price: z.boolean().optional(),
				convert_currency: z.boolean().optional(),
				show_original_price: z.boolean().optional(),
				mobile_nav: z.boolean().optional(),
				show_subscription_progress: z.boolean().optional(),
				week_starts_sunday: z.boolean().optional(),
				disabled_to_bottom: z.boolean().optional(),
				hide_disabled: z.boolean().optional(),
				remove_background: z.boolean().optional(),
				square_icons: z.boolean().optional(),
				main_color: z.string().optional(),
				accent_color: z.string().optional(),
				hover_color: z.string().optional(),
				css: z.string().optional(),
			},
			async (args) => {
				const fields = settingsFields(args);
				if (Object.keys(fields).length === 0) {
					throw new WallosError(
						"Nothing to update",
						"Pass at least one setting. Wallos answers an empty write with success and changes nothing.",
					);
				}
				return this.run((client) => client.setSettings(fields));
			},
		);

		this.server.tool(
			"get_notification_settings",
			`Read ${props.username}'s Wallos notification settings`,
			{},
			async () => this.run((client) => client.getNotificationSettings()),
		);

		this.server.tool(
			"get_fixer_settings",
			`Read ${props.username}'s Wallos exchange-rate provider settings`,
			{},
			async () => this.run((client) => client.getFixer()),
		);

		this.server.tool(
			"update_fixer_settings",
			`Update ${props.username}'s Wallos exchange-rate provider. The key is required on every call, because Wallos stores what it is given and treats an absent key as an instruction to clear the stored one — changing only the provider would delete it. Pass an empty string to clear it deliberately.`,
			{
				fixer_api_key: z
					.string()
					.describe("The provider's API key; an empty string clears the stored settings"),
				provider: z
					.union([z.literal(0), z.literal(1)])
					.optional()
					.describe("0 Fixer.io, 1 APILayer"),
			},
			async ({ fixer_api_key, provider }) =>
				this.run((client) =>
					client.setFixer({
						fixer_api_key,
						...(provider !== undefined ? { provider } : {}),
					}),
				),
		);
	}

	private registerAdminTools(props: Props) {
		this.server.tool(
			"get_admin_settings",
			`Read instance-wide admin settings on ${props.baseUrl}. Requires a Wallos admin key.`,
			{},
			async () => this.run((client) => client.getAdminSettings()),
		);

		this.server.tool(
			"update_admin_settings",
			`Rewrite instance-wide admin settings on ${props.baseUrl} (registration, SMTP, login). Requires a Wallos admin key.`,
			{
				registrations_open: z.boolean().optional(),
				max_users: z.number().int().optional(),
				require_email_verification: z.boolean().optional(),
				server_url: z.string().optional(),
				smtp_address: z.string().optional(),
				smtp_port: z.number().int().optional(),
				smtp_username: z.string().optional(),
				smtp_password: z.string().optional(),
				from_email: z.string().optional(),
				encryption: z.enum(["tls", "ssl"]).optional(),
				login_disabled: z.boolean().optional(),
				update_notification: z.boolean().optional(),
				oidc_oauth_enabled: z.boolean().optional(),
				local_webhook_notifications_allowlist: z.string().optional(),
			},
			async (args) => this.run((client) => client.setAdminSettings(adminFields(args))),
		);

		this.server.tool(
			"get_oidc_settings",
			`Read instance-wide OIDC settings on ${props.baseUrl}`,
			{},
			async () => this.run((client) => client.getOidcSettings()),
		);

		this.server.tool(
			"update_oidc_settings",
			`Rewrite instance-wide OIDC settings on ${props.baseUrl}. This changes how everyone signs in.`,
			{
				oidc_enabled: z.boolean().optional(),
				name: z.string().optional(),
				client_id: z.string().optional(),
				client_secret: z.string().optional(),
				authorization_url: z.string().optional(),
				token_url: z.string().optional(),
				user_info_url: z.string().optional(),
				redirect_url: z.string().optional(),
				logout_url: z.string().optional(),
				user_identifier_field: z.string().optional(),
				scopes: z.string().optional(),
				auth_style: z.enum(["auto", "header", "params"]).optional(),
				auto_create_user: z.boolean().optional(),
				password_login_disabled: z.boolean().optional(),
				require_email_verified: z.boolean().optional(),
			},
			async (args) => this.run((client) => client.setOidcSettings(oidcFields(args))),
		);

		this.server.tool(
			"set_password_login_disabled",
			`Disable or re-enable password login on ${props.baseUrl} for every user`,
			{ disable: z.boolean() },
			async ({ disable }) => this.run((client) => client.setDisablePasswordLogin(disable)),
		);
	}
}

function assignDefined(
	fields: Record<string, FormValue>,
	source: Record<string, FormValue>,
	keys: string[],
) {
	for (const key of keys) {
		const value = source[key];
		if (value !== undefined) fields[key] = value;
	}
}

function assignFlags(
	fields: Record<string, FormValue>,
	source: Record<string, boolean | undefined>,
	keys: string[],
) {
	for (const key of keys) {
		const value = source[key];
		if (value !== undefined) fields[key] = value ? "1" : "0";
	}
}

type ListArgs = {
	member?: number[] | undefined;
	category?: number | undefined;
	payment_method?: number | undefined;
	state?: "active" | "inactive" | undefined;
	sort?: (typeof sortValues)[number] | undefined;
	disabled_to_bottom?: boolean | undefined;
	convert_currency?: boolean | undefined;
	all_user_subscriptions?: boolean | undefined;
};

function listSubscriptionFields(args: ListArgs): Record<string, FormValue> {
	const fields: Record<string, FormValue> = {};
	if (args.member && args.member.length > 0) fields.member = args.member.join(",");
	if (args.category !== undefined) fields.category = args.category;
	if (args.payment_method !== undefined) fields.payment = args.payment_method;
	if (args.state === "active") fields.state = "0";
	if (args.state === "inactive") fields.state = "1";
	if (args.sort !== undefined) fields.sort = args.sort;
	// Wallos compares these two with === 'true', so the wire value is the
	// string true, not 1.
	if (args.disabled_to_bottom) fields.disabled_to_bottom = "true";
	if (args.convert_currency) fields.convert_currency = "true";
	if (args.all_user_subscriptions) fields["all-user-subscription"] = "1";
	return fields;
}

type SubscriptionWrite = {
	id?: number | undefined;
	name?: string | undefined;
	price?: number | undefined;
	auto_renew?: boolean | undefined;
	notes?: string | undefined;
	url?: string | undefined;
	logo_url?: string | undefined;
	notify?: boolean | undefined;
	notify_days_before?: number | undefined;
	inactive?: boolean | undefined;
	cancellation_date?: string | undefined;
	replacement_subscription_id?: number | undefined;
};

function subscriptionWriteFields(
	action: "add" | "edit",
	args: SubscriptionWrite,
	ids: ResolvedIds,
	period: CycleFrequency | null,
	start: string | undefined,
	next: string | undefined,
): Record<string, FormValue> {
	const fields: Record<string, FormValue> = { action };
	if (action === "edit" && args.id !== undefined) fields.id = args.id;
	assignDefined(fields, args as Record<string, FormValue>, [
		"name",
		"price",
		"notes",
		"url",
		"logo_url",
		"notify_days_before",
		"cancellation_date",
		"replacement_subscription_id",
	]);
	assignDefined(fields, ids as Record<string, FormValue>, [
		"currency_id",
		"category_id",
		"payment_method_id",
		"payer_user_id",
	]);
	if (period) {
		fields.cycle = period.cycle;
		fields.frequency = period.frequency;
	}
	if (start !== undefined) fields.start_date = start;
	if (next !== undefined) fields.next_payment = next;
	assignFlags(
		fields,
		{ auto_renew: args.auto_renew, notify: args.notify, inactive: args.inactive },
		["auto_renew", "notify", "inactive"],
	);
	return fields;
}

function settingsFields(
	args: Record<string, FormValue | boolean | undefined>,
): Record<string, FormValue> {
	const fields: Record<string, FormValue> = {};
	assignDefined(fields, args, [
		"dark_theme",
		"color_theme",
		"main_color",
		"accent_color",
		"hover_color",
		"css",
	]);
	assignFlags(fields, args as Record<string, boolean | undefined>, [
		"monthly_price",
		"convert_currency",
		"show_original_price",
		"mobile_nav",
		"show_subscription_progress",
		"week_starts_sunday",
		"disabled_to_bottom",
		"hide_disabled",
		"remove_background",
		"square_icons",
	]);
	return fields;
}

function adminFields(
	args: Record<string, FormValue | boolean | undefined>,
): Record<string, FormValue> {
	const fields: Record<string, FormValue> = {};
	assignDefined(fields, args, [
		"max_users",
		"server_url",
		"smtp_address",
		"smtp_port",
		"smtp_username",
		"smtp_password",
		"from_email",
		"encryption",
		"local_webhook_notifications_allowlist",
	]);
	assignFlags(fields, args as Record<string, boolean | undefined>, [
		"registrations_open",
		"require_email_verification",
		"login_disabled",
		"update_notification",
		"oidc_oauth_enabled",
	]);
	return fields;
}

function oidcFields(
	args: Record<string, FormValue | boolean | undefined>,
): Record<string, FormValue> {
	const fields: Record<string, FormValue> = {};
	assignDefined(fields, args, [
		"name",
		"client_id",
		"client_secret",
		"authorization_url",
		"token_url",
		"user_info_url",
		"redirect_url",
		"logout_url",
		"user_identifier_field",
		"scopes",
		"auth_style",
	]);
	assignFlags(fields, args as Record<string, boolean | undefined>, [
		"oidc_enabled",
		"auto_create_user",
		"password_login_disabled",
		"require_email_verified",
	]);
	return fields;
}

const mcpAgent = WallosMCP.serve("/mcp{/:label}?") as {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

const mcpHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const props = ctx.props as Props | undefined;
		const account = props ? accountIdFromProps(props) : undefined;
		const sessionId = request.headers.get("mcp-session-id");
		if (account && sessionId) {
			const session = await getAgentByName<Env, WallosMCP>(
				env.MCP_OBJECT as unknown as DurableObjectNamespace<WallosMCP>,
				`streamable-http:${sessionId}`,
				{ props: ctx.props as Record<string, unknown> },
			);
			if (!(await session.isOwnedBy(account))) {
				return new Response("this MCP session belongs to a different Wallos account", {
					status: 403,
				});
			}
		}

		const forwarded = new Request(request);
		forwarded.headers.delete(ACCOUNT_HEADER);
		forwarded.headers.delete(PROPS_HEADER);
		if (account) forwarded.headers.set(ACCOUNT_HEADER, account);
		return mcpAgent.fetch(forwarded, env, ctx);
	},
};

type ProviderHandler = { fetch: ExportedHandlerFetchHandler<unknown> };

const provider = new OAuthProvider({
	apiHandlers: {
		"/mcp": mcpHandler as unknown as ProviderHandler,
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: WallosHandler as unknown as ProviderHandler,
	tokenEndpoint: "/token",
	allowPlainPKCE: false,
});

const OAUTH_BODY_LIMIT = 64 * 1024;
const BOUNDED_ENDPOINTS = new Set(["/token", "/register"]);

function bodyLimitFor(path: string): number | null {
	if (BOUNDED_ENDPOINTS.has(path)) return OAUTH_BODY_LIMIT;
	if (path === "/mcp" || path.startsWith("/mcp/")) return MCP_MESSAGE_LIMIT;
	return null;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const path = new URL(request.url).pathname;
		const limit = request.method === "POST" ? bodyLimitFor(path) : null;
		if (limit === null) {
			return provider.fetch(request, env, ctx);
		}
		if (path === "/register" && env.REGISTER_LIMITER) {
			const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
			const { success } = await env.REGISTER_LIMITER.limit({ key: caller });
			if (!success) {
				return new Response("Too many registration requests", { status: 429 });
			}
		}
		let body: Uint8Array;
		try {
			body = await readBoundedBody(request, limit);
		} catch (error: unknown) {
			if (error instanceof BodyTooLarge) {
				return new Response("Request body too large", { status: 413 });
			}
			throw error;
		}
		const bounded = new Request(request.url, {
			method: "POST",
			headers: request.headers,
			body,
		});
		return provider.fetch(bounded, env, ctx);
	},
};
