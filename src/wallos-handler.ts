import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import barlow400 from "../assets/barlow-400-latin.woff2";
import barlow400ext from "../assets/barlow-400-latin-ext.woff2";
import barlow600 from "../assets/barlow-600-latin.woff2";
import barlow600ext from "../assets/barlow-600-latin-ext.woff2";
import { homePage } from "./home";
import { pickLocale } from "./i18n";
import { signInPage } from "./sign-in";
import {
	accountId,
	BodyTooLarge,
	hostnameOf,
	isHostAllowed,
	isPrivateHost,
	isUnderAccountCap,
	meetsMinimum,
	normalizeBaseUrl,
	type Props,
	parseLimit,
	readBoundedBody,
	redactSecret,
} from "./utils";
import { WallosClient, WallosError } from "./wallos";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
	verifyApprovalState,
} from "./workers-oauth-utils";

const MAX_APPROVAL_BODY_BYTES = 64 * 1024;

async function readBoundedForm(request: Request, limit: number): Promise<FormData> {
	const body = await readBoundedBody(request, limit);
	return new Request(request.url, { method: "POST", headers: request.headers, body }).formData();
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

const FONTS: Record<string, ArrayBuffer> = {
	"barlow-400-latin.woff2": barlow400 as unknown as ArrayBuffer,
	"barlow-400-latin-ext.woff2": barlow400ext as unknown as ArrayBuffer,
	"barlow-600-latin.woff2": barlow600 as unknown as ArrayBuffer,
	"barlow-600-latin-ext.woff2": barlow600ext as unknown as ArrayBuffer,
};

// The file name carries the version of the face it holds, so it can be cached
// for as long as a browser is willing to.
app.get("/_font/:name", (c) => {
	const font = FONTS[c.req.param("name")];
	if (!font) return c.notFound();
	return new Response(font, {
		headers: {
			"Content-Type": "font/woff2",
			"Cache-Control": "public, max-age=31536000, immutable",
			"Access-Control-Allow-Origin": "*",
		},
	});
});

app.get("/", (c) => homePage(new URL(c.req.url).origin));

app.get("/authorize", async (c) => {
	let oauthReqInfo: AuthRequest;
	try {
		oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	} catch (error) {
		console.error("GET /authorize parse error:", error);
		return c.text(
			"Unknown or invalid OAuth client. Connect without entering any client ID or secret — this server registers MCP clients automatically.",
			400,
		);
	}
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	const client = await c.env.OAUTH_PROVIDER.lookupClient(clientId).catch(() => null);
	if (!client) {
		return c.text(
			"Unknown OAuth client. Connect without entering any client ID or secret — this server registers MCP clients automatically.",
			400,
		);
	}

	if (await isClientApproved(c.req.raw, clientId, env.COOKIE_ENCRYPTION_KEY)) {
		return redirectToSignIn(c.env.OAUTH_KV, oauthReqInfo, c.req.raw);
	}

	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return await renderApprovalDialog(c.req.raw, {
		client,
		csrfToken,
		server: {
			description:
				"Remote MCP server for a self-hosted Wallos instance. Approving lets the connecting client use the Wallos account you sign in with next.",
			consentNote:
				"The next page asks for the Wallos URL and the API key from Settings → your profile. The key stays on this Worker.",
			name: "Wallos MCP",
		},
		setCookie,
		cookieSecret: env.COOKIE_ENCRYPTION_KEY,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		let formData: FormData;
		try {
			formData = await readBoundedForm(c.req.raw, MAX_APPROVAL_BODY_BYTES);
		} catch (error: unknown) {
			return error instanceof BodyTooLarge
				? c.text("Request body too large", 413)
				: c.text("Invalid form data", 400);
		}
		const csrfClearCookie = validateCSRFToken(formData, c.req.raw);

		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		const verified = await verifyApprovalState(encodedState, env.COOKIE_ENCRYPTION_KEY);
		if (verified === null) {
			return c.text("Invalid state data", 400);
		}
		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(verified);
		} catch {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo?.clientId) {
			return c.text("Invalid request", 400);
		}

		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			env.COOKIE_ENCRYPTION_KEY,
		);

		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

		const headers = new Headers();
		headers.append("Set-Cookie", approvedClientCookie);
		headers.append("Set-Cookie", sessionBindingCookie);
		headers.append("Set-Cookie", csrfClearCookie.clearCookie);
		headers.set("Location", new URL(`/sign-in?state=${stateToken}`, c.req.url).href);
		return new Response(null, { status: 302, headers });
	} catch (error: unknown) {
		console.error("POST /authorize error:", error);
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text("Internal server error", 500);
	}
});

async function redirectToSignIn(
	kv: KVNamespace,
	oauthReqInfo: AuthRequest,
	request: Request,
	extraCookies: string[] = [],
): Promise<Response> {
	const { stateToken } = await createOAuthState(oauthReqInfo, kv);
	const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
	const headers = new Headers({
		Location: new URL(`/sign-in?state=${stateToken}`, request.url).href,
	});
	headers.append("Set-Cookie", sessionBindingCookie);
	for (const cookie of extraCookies) headers.append("Set-Cookie", cookie);
	return new Response(null, { status: 302, headers });
}

app.get("/sign-in", async (c) => {
	const url = new URL(c.req.url);
	const stateToken = url.searchParams.get("state");
	if (!stateToken) {
		return c.text("Missing state parameter", 400);
	}
	try {
		await peekBoundState(c.req.raw, c.env.OAUTH_KV, stateToken);
	} catch (error: unknown) {
		if (error instanceof OAuthError) return error.toResponse();
		throw error;
	}
	const { token: csrfToken, setCookie } = generateCSRFProtection();
	return signInPage({
		csrfToken,
		stateToken,
		locale: pickLocale(c.req.header("accept-language") ?? null, url.searchParams.get("lang")),
		setCookie,
	});
});

app.post("/sign-in", async (c) => {
	let formData: FormData;
	try {
		formData = await readBoundedForm(c.req.raw, MAX_APPROVAL_BODY_BYTES);
	} catch (error: unknown) {
		return error instanceof BodyTooLarge
			? c.text("Request body too large", 413)
			: c.text("Invalid form data", 400);
	}

	try {
		const csrfClearCookie = validateCSRFToken(formData, c.req.raw);
		const spent = await spendSignInState(formData, c.req.raw, c.env.OAUTH_KV);
		if (spent instanceof Response) return spent;
		return finishSignIn(
			c.env,
			formData,
			spent.oauthReqInfo,
			[csrfClearCookie.clearCookie, spent.clearSessionCookie],
			pickLocale(c.req.header("accept-language") ?? null, formString(formData, "lang")),
		);
	} catch (error: unknown) {
		console.error("POST /sign-in error:", error);
		if (error instanceof OAuthError) return error.toResponse();
		return c.text("Internal server error", 500);
	}
});

async function spendSignInState(
	formData: FormData,
	request: Request,
	kv: KVNamespace,
): Promise<{ oauthReqInfo: AuthRequest; clearSessionCookie: string } | Response> {
	const formState = formData.get("oauth_state");
	if (!formState || typeof formState !== "string") {
		return new Response("Missing state in form data", { status: 400 });
	}
	const stateUrl = new URL(request.url);
	stateUrl.searchParams.set("state", formState);
	try {
		const result = await validateOAuthState(
			new Request(stateUrl, { headers: request.headers }),
			kv,
		);
		if (!result.oauthReqInfo.clientId) {
			return new Response("Invalid OAuth request data", { status: 400 });
		}
		return { oauthReqInfo: result.oauthReqInfo, clearSessionCookie: result.clearCookie };
	} catch (error: unknown) {
		if (error instanceof OAuthError) return error.toResponse();
		throw error;
	}
}

async function finishSignIn(
	envBindings: Env & { OAUTH_PROVIDER: OAuthHelpers },
	formData: FormData,
	oauthReqInfo: AuthRequest,
	cookies: string[],
	locale: string,
): Promise<Response> {
	const checked = await checkSignInCredentials(
		envBindings,
		formData,
		oauthReqInfo,
		cookies,
		locale,
	);
	if (checked instanceof Response) return checked;
	const { props, hostname, userId } = checked;
	const marker = `account:${accountId(props.baseUrl, userId)}`;
	const cap = await refuseIfOverCap(envBindings, marker);
	if (cap) return cap;

	const { redirectTo } = await envBindings.OAUTH_PROVIDER.completeAuthorization({
		metadata: { label: `${props.username} @ ${hostname}` },
		props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: accountId(props.baseUrl, userId),
	});
	await envBindings.OAUTH_KV.put(marker, new Date().toISOString());
	const headers = new Headers({ Location: redirectTo });
	for (const cookie of cookies) headers.append("Set-Cookie", cookie);
	return new Response(null, { status: 302, headers });
}

async function checkSignInCredentials(
	envBindings: Env,
	formData: FormData,
	oauthReqInfo: AuthRequest,
	cookies: string[],
	locale: string,
): Promise<{ props: Props; hostname: string; userId: number } | Response> {
	const rawUrl = formString(formData, "base_url");
	const apiKey = formString(formData, "api_key");
	if (!rawUrl || !apiKey) {
		return signInAgain(
			envBindings.OAUTH_KV,
			oauthReqInfo,
			cookies,
			"Both the Wallos URL and the API key are required.",
			locale,
		);
	}
	let baseUrl: string;
	try {
		baseUrl = normalizeBaseUrl(rawUrl);
	} catch (error: unknown) {
		return signInAgain(
			envBindings.OAUTH_KV,
			oauthReqInfo,
			cookies,
			error instanceof Error ? error.message : "Invalid Wallos URL",
			locale,
		);
	}
	const hostname = hostnameOf(baseUrl);
	if (!isHostAllowed(hostname, envBindings.ALLOWED_HOSTS)) {
		return signInAgain(
			envBindings.OAUTH_KV,
			oauthReqInfo,
			cookies,
			"This Wallos host is not allowed on this server.",
			locale,
			403,
		);
	}
	// global_fetch_strictly_public already refuses these at the platform, where
	// the failure is an opaque network error. Naming the reason here is the
	// difference between "your LAN address is not reachable from a Worker" and
	// a sign-in that appears to hang.
	if (isPrivateHost(hostname)) {
		return signInAgain(
			envBindings.OAUTH_KV,
			oauthReqInfo,
			cookies,
			"This Wallos URL points at a private or loopback address. A Worker reaches public addresses only — expose the instance on a public hostname, through a tunnel if it lives on a home network.",
			locale,
			403,
		);
	}
	const bound = await bindWallosUser(baseUrl, apiKey);
	if (typeof bound === "string") {
		return signInAgain(envBindings.OAUTH_KV, oauthReqInfo, cookies, bound, locale);
	}
	return { props: { baseUrl, apiKey, ...bound }, hostname, userId: bound.userId };
}

async function bindWallosUser(
	baseUrl: string,
	apiKey: string,
): Promise<{ userId: number; username: string; email: string; version: string } | string> {
	const client = new WallosClient(baseUrl, apiKey);
	let user: Record<string, unknown>;
	let version = "unknown";
	try {
		user = await client.getUser();
		try {
			version = (await client.getVersion()).version;
		} catch {
			// Sign-in can finish without a version; gated tools stay off until a
			// later session reads one.
		}
	} catch (error: unknown) {
		const message =
			error instanceof WallosError ? error.message : "Could not reach Wallos at that URL.";
		return redactSecret(message, apiKey);
	}
	const userId = Number(user.id);
	const username = typeof user.username === "string" ? user.username : "";
	const email = typeof user.email === "string" ? user.email : "";
	if (!Number.isInteger(userId) || userId <= 0 || !username) {
		return "Wallos returned a user record this server cannot bind.";
	}
	if (!meetsMinimum(version)) {
		return `This Wallos is ${version}. The API this server uses arrived in 5.0.0, so every tool would fail against it — upgrade the instance first.`;
	}
	return { userId, username, email, version };
}

async function refuseIfOverCap(envBindings: Env, marker: string): Promise<Response | null> {
	const seen = await envBindings.OAUTH_KV.get(marker);
	if (seen) return null;
	const known = await envBindings.OAUTH_KV.list({ prefix: "account:", limit: 1000 });
	const admitted = known.list_complete ? known.keys.length : Number.POSITIVE_INFINITY;
	if (isUnderAccountCap(admitted, true, parseLimit(envBindings.MAX_ACCOUNTS, 25))) return null;
	console.warn("account cap reached; refused a new sign-in");
	return new Response(
		"This server has reached its limit of connected accounts. Ask its operator to raise MAX_ACCOUNTS.",
		{ status: 429 },
	);
}

async function signInAgain(
	kv: KVNamespace,
	oauthReqInfo: AuthRequest,
	cookies: string[],
	error: string,
	locale: string,
	status = 400,
): Promise<Response> {
	const { stateToken } = await createOAuthState(oauthReqInfo, kv);
	const { setCookie } = await bindStateToSession(stateToken);
	const { token: csrfToken, setCookie: csrfCookie } = generateCSRFProtection();
	return signInPage({
		csrfToken,
		stateToken,
		locale,
		error,
		status,
		setCookie,
		extraCookies: [...cookies, csrfCookie],
	});
}

function formString(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === "string" ? value.trim() : "";
}

async function peekBoundState(
	request: Request,
	kv: KVNamespace,
	stateToken: string,
): Promise<void> {
	const stored = await kv.get(`oauth:state:${stateToken}`);
	if (!stored) {
		throw new OAuthError("invalid_request", "Invalid or expired state", 400);
	}
	const cookieHeader = request.headers.get("Cookie") || "";
	const cookies = cookieHeader.split(";").map((c) => c.trim());
	const name = "__Host-CONSENTED_STATE=";
	const cookie = cookies.find((c) => c.startsWith(name));
	const consented = cookie ? cookie.slice(name.length) : null;
	if (!consented) {
		throw new OAuthError(
			"invalid_request",
			"Missing session binding cookie - authorization flow must be restarted",
			400,
		);
	}
	const data = new TextEncoder().encode(stateToken);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hash = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	if (hash !== consented) {
		throw new OAuthError(
			"invalid_request",
			"State token does not match session - possible CSRF attack detected",
			400,
		);
	}
}

export { app as WallosHandler };
