import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import setupGuide from "../docs/index.html";
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
	sanitizeText,
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

const guide = setupGuide as unknown as string;

app.get(
	"/",
	() =>
		new Response(guide, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
			},
		}),
);

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
		return finishSignIn(c.env, formData, spent.oauthReqInfo, [
			csrfClearCookie.clearCookie,
			spent.clearSessionCookie,
		]);
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
): Promise<Response> {
	const checked = await checkSignInCredentials(envBindings, formData, oauthReqInfo, cookies);
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
): Promise<{ props: Props; hostname: string; userId: number } | Response> {
	const rawUrl = formString(formData, "base_url");
	const apiKey = formString(formData, "api_key");
	if (!rawUrl || !apiKey) {
		return signInAgain(
			envBindings.OAUTH_KV,
			oauthReqInfo,
			cookies,
			"Both the Wallos URL and the API key are required.",
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
		);
	}
	const hostname = hostnameOf(baseUrl);
	if (!isHostAllowed(hostname, envBindings.ALLOWED_HOSTS)) {
		return signInAgain(
			envBindings.OAUTH_KV,
			oauthReqInfo,
			cookies,
			"This Wallos host is not allowed on this server.",
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
			403,
		);
	}
	const bound = await bindWallosUser(baseUrl, apiKey);
	if (typeof bound === "string") {
		return signInAgain(envBindings.OAUTH_KV, oauthReqInfo, cookies, bound);
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
	status = 400,
): Promise<Response> {
	const { stateToken } = await createOAuthState(oauthReqInfo, kv);
	const { setCookie } = await bindStateToSession(stateToken);
	const { token: csrfToken, setCookie: csrfCookie } = generateCSRFProtection();
	return signInPage({
		csrfToken,
		stateToken,
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

function signInPage(opts: {
	csrfToken: string;
	stateToken: string;
	error?: string;
	baseUrl?: string;
	status?: number;
	setCookie?: string;
	extraCookies?: string[];
}): Response {
	const error = opts.error ? `<p class="error">${sanitizeText(opts.error)}</p>` : "";
	const baseUrl = sanitizeText(opts.baseUrl ?? "");
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wallos MCP | Sign in</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         line-height: 1.6; color: #333; background: #f9fafb; margin: 0; }
  .card { max-width: 520px; margin: 3rem auto; background: #fff; border-radius: 8px;
          box-shadow: 0 8px 36px 8px rgba(0, 0, 0, 0.1); padding: 2rem; }
  h1 { font-size: 1.3rem; font-weight: 500; margin-top: 0; }
  label { display: block; font-weight: 500; margin: 1rem 0 .35rem; }
  input[type=url], input[type=password] {
    width: 100%; box-sizing: border-box; padding: .65rem .75rem; border: 1px solid #e5e7eb;
    border-radius: 6px; font: inherit;
  }
  .hint { color: #555; font-size: .92rem; margin: 0 0 1rem; }
  .custody { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 6px;
             padding: .8rem 1rem; font-size: .88rem; color: #444; margin: 1.25rem 0 0; }
  .custody a { color: #0070f3; }
  .error { background: #fff1f0; border: 1px solid #f5c2c0; color: #8a1f11;
           border-radius: 6px; padding: .75rem 1rem; }
  .button { margin-top: 1.5rem; padding: .75rem 1.5rem; border: none; border-radius: 6px;
            background: #0070f3; color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
</style>
</head>
<body>
<div class="card">
  <h1>Connect a Wallos account</h1>
  <p class="hint">The base URL of your Wallos instance, and the API key from Settings → your profile.</p>
  ${error}
  <form method="post" action="/sign-in">
    <input type="hidden" name="csrf_token" value="${sanitizeText(opts.csrfToken)}">
    <input type="hidden" name="oauth_state" value="${sanitizeText(opts.stateToken)}">
    <label for="base_url">Wallos URL</label>
    <input id="base_url" name="base_url" type="url" required placeholder="https://wallos.example.com" value="${baseUrl}">
    <label for="api_key">API key</label>
    <input id="api_key" name="api_key" type="password" required autocomplete="off">
    <button type="submit" class="button">Sign in</button>
  </form>
  <p class="custody">This key is stored, encrypted, by whoever runs this deployment, and it carries
  the same authority over your subscriptions as your password. Regenerating the key in Wallos ends
  that access immediately. To keep it on your own infrastructure instead, deploy this server
  yourself — <a href="https://github.com/mkpoli/wallos-mcp">github.com/mkpoli/wallos-mcp</a>.</p>
</div>
</body>
</html>`;
	const headers = new Headers({
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Security-Policy": "frame-ancestors 'none'",
		"X-Frame-Options": "DENY",
	});
	if (opts.setCookie) headers.append("Set-Cookie", opts.setCookie);
	for (const cookie of opts.extraCookies ?? []) headers.append("Set-Cookie", cookie);
	return new Response(html, { status: opts.status ?? 200, headers });
}

export { app as WallosHandler };
