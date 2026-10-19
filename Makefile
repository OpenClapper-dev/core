# The local development stack: thin wrappers around the pnpm scripts in package.json, which stay the
# source of truth. Everything runs in the foreground; stop a server with Ctrl-C. Deploying is not
# here: it runs from a deployment repository (docs/self-hosting.md).
.PHONY: help init all all-down all-restart dev worker dashboard mobile dev-build apk-local

help: ## Show this list
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  make %-10s %s\n", $$1, $$2}'

init: ## Write the gitignored dev files and apply D1 migrations (once per checkout)
	pnpm dev:init

all: ## Everything local in one tmux session: Worker, dashboard, mobile (tunnel + Metro) and a control strip (r restart, q quit)
	bash scripts/dev-all.sh up

all-down: ## Stop all of `make all`: Ctrl-C each server, close the session, free the ports
	bash scripts/dev-all.sh down

all-restart: ## Restart the servers of `make all` in their panes (starts it when it is not up)
	bash scripts/dev-all.sh restart

dev: ## Worker on :8787 and dashboard on :5173, in parallel
	pnpm dev

worker: ## Worker only -> http://localhost:8787
	pnpm dev:worker

dashboard: ## Dashboard only -> http://localhost:5173 (needs `make worker` for /api)
	pnpm dev:dashboard

mobile: ## Local Worker behind a quick tunnel + Metro for the dev build (Fielder Dev); LOCAL data
	pnpm dev:mobile

dev-build: ## Development build (Fielder Dev) in Docker, to the Windows Downloads folder; rebuild after native changes
	VARIANT=dev bash scripts/apk-local.sh

apk-local: ## Production APK in Docker for one server: API_URL=https://… make apk-local (key: scripts/keystore.sh)
	VARIANT=release bash scripts/apk-local.sh
