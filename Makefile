# The local development stack: thin wrappers around the pnpm scripts in package.json, which stay the
# source of truth. Everything runs in the foreground; stop a server with Ctrl-C. Deploying is not
# here: it runs from a deployment repository (docs/self-hosting.md).
.PHONY: help init check all all-down all-restart dev worker studio admin mobile dev-build apk-local

help: ## Show this list
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  make %-10s %s\n", $$1, $$2}'

init: ## Write the gitignored dev files and apply D1 migrations (once per checkout)
	pnpm dev:init

check: ## The CI lane: lint, typecheck, unit tests, build dry runs (Vite, both Workers, Expo export)
	pnpm check

all: ## Everything local in one tmux session: Worker, Studio, admin board, mobile (tunnel + Metro) and a control strip (r restart, q quit)
	bash scripts/dev-all.sh up

all-down: ## Stop all of `make all`: Ctrl-C each server, close the session, free the ports
	bash scripts/dev-all.sh down

all-restart: ## Restart the servers of `make all` in their panes (starts it when it is not up)
	bash scripts/dev-all.sh restart

dev: ## Worker on :8787 and the Studio on :5173, in parallel
	pnpm dev

worker: ## Worker only -> http://localhost:8787
	pnpm dev:worker

studio: ## Studio only -> http://localhost:5173 (needs `make worker` for /api)
	pnpm dev:studio

admin: ## Admin board -> http://localhost:5174 with its Worker on :8788 (local D1, no Access: admin@localhost)
	pnpm dev:admin

mobile: ## Local Worker behind a quick tunnel + Metro for the dev build (OpenClapper Dev); LOCAL data
	pnpm dev:mobile

dev-build: ## Development build (OpenClapper Dev) in Docker, to the Windows Downloads folder; rebuild after native changes
	VARIANT=dev bash scripts/apk-local.sh

apk-local: ## OpenClapper Local in Docker, a complete app for one server, no secrets: API_URL=https://… make apk-local
	VARIANT=local bash scripts/apk-local.sh
