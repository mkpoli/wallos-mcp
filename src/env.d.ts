// Secrets are not in the generated Env (wrangler types only sees wrangler.jsonc
// vars). Both are documented on the package and read at runtime.
interface Env {
	COOKIE_ENCRYPTION_KEY: string;
	ALLOWED_HOSTS: string;
}

declare namespace Cloudflare {
	interface Env {
		COOKIE_ENCRYPTION_KEY: string;
		ALLOWED_HOSTS: string;
	}
}
