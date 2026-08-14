import { mock } from "bun:test";

// The Worker imports Cloudflare runtime modules that only exist inside workerd,
// so tests that reach the agent or the OAuth handler stand them in.
class Stub {}

const runtimeShim: unknown = new Proxy(
	{ env: { COOKIE_ENCRYPTION_KEY: "cookie-secret" }, default: {} },
	{
		get: (target: Record<string, unknown>, prop: string) => (prop in target ? target[prop] : Stub),
		has: () => true,
		ownKeys: () => [
			"env",
			"default",
			"WorkerEntrypoint",
			"DurableObject",
			"RpcTarget",
			"WorkflowEntrypoint",
			"EmailMessage",
			"connect",
			"exports",
			"__esModule",
		],
		getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: Stub }),
	},
);

for (const name of [
	"cloudflare:workers",
	"cloudflare:email",
	"cloudflare:sockets",
	"cloudflare:workflows",
]) {
	mock.module(name, () => runtimeShim);
}
