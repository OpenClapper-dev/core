# Thin wrappers around the pnpm scripts in package.json, which stay the source
# of truth. Everything runs in the foreground; stop a server with Ctrl-C.
.PHONY: help init dev worker dashboard mobile dev-build login deploy apk-cloud apk-local

# Wrangler's OAuth token lacks account:read, so commands that look up the account need the id.
export CLOUDFLARE_ACCOUNT_ID ?= 3868cbc17be171c90972dd32e41e7783

help: ## Show this list
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  make %-10s %s\n", $$1, $$2}'

init: ## Write the gitignored dev files and apply D1 migrations (once per checkout)
	pnpm dev:init

dev: ## Worker on :8787 and dashboard on :5173, in parallel
	pnpm dev

worker: ## Worker only -> http://localhost:8787
	pnpm dev:worker

dashboard: ## Dashboard only -> http://localhost:5173 (needs `make worker` for /api)
	pnpm dev:dashboard

mobile: ## Local Worker behind a quick tunnel + Metro for the dev build (Fielder Dev); LOCAL data
	pnpm dev:mobile

dev-build: ## Development build (Fielder Dev) locally in Docker, no EAS quota; rebuild after native changes
	PROFILE=dev-client bash scripts/apk-local.sh

login: ## Log wrangler in to Cloudflare (device code, works in WSL)
	pnpm wrangler login --device

deploy: ## Production: apply new D1 migrations, build the dashboard, deploy Worker + assets
	pnpm -C apps/worker migrate:remote
	pnpm -C apps/worker run deploy

apk-cloud: ## APK on EAS (cloud build; counts against the monthly quota)
	pnpm -C apps/mobile build:apk

apk-local: ## APK built locally in Docker, copied to the Windows Downloads folder (~10 min)
	bash scripts/apk-local.sh
