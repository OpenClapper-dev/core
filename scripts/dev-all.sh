#!/usr/bin/env bash
# make all: the whole local stack in one tmux session "fielder", one pane per server:
#   left top: the Worker (:8787) · left bottom: the dashboard (:5173) · right: make mobile (tunnel + Metro).
# The mobile pane waits for the Worker, so mobile.sh only adds a tunnel to it (one Worker, one local D1).
# Ctrl-C stops one pane's server; `make all-stop` (or `tmux kill-session -t fielder`) stops everything.
# Running it again attaches to the session that is already up.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
session="${SESSION:-fielder}"
port="${PORT:-8787}"

command -v tmux >/dev/null || { echo "tmux is not installed (sudo apt install tmux)." >&2; exit 1; }

attach() { if [ -n "${TMUX:-}" ]; then tmux switch-client -t "$session"; else tmux attach -t "$session"; fi; }

if tmux has-session -t "$session" 2>/dev/null; then
  echo "The session \"$session\" is already running; attaching."
  attach
  exit 0
fi

# A server that exits keeps its pane open, so its last error stays readable.
tmux new-session -d -s "$session" -n stack -c "$root" -x "$(tput cols 2>/dev/null || echo 200)" -y "$(tput lines 2>/dev/null || echo 50)"
tmux set-option -t "$session" remain-on-exit on
tmux set-option -t "$session" mouse on
tmux set-option -t "$session" pane-border-status top
tmux set-option -t "$session" pane-border-format " #{pane_title} "

worker="$(tmux display-message -p -t "$session:stack" '#{pane_id}')"
mobile="$(tmux split-window -h -t "$worker" -c "$root" -P -F '#{pane_id}')"
dashboard="$(tmux split-window -v -t "$worker" -c "$root" -P -F '#{pane_id}')"

tmux select-pane -t "$worker" -T "worker :$port"
tmux select-pane -t "$dashboard" -T "dashboard :5173"
tmux select-pane -t "$mobile" -T "mobile (tunnel + Metro)"

tmux send-keys -t "$worker" "pnpm dev:worker" C-m
tmux send-keys -t "$dashboard" "pnpm dev:dashboard" C-m
tmux send-keys -t "$mobile" "echo 'Waiting for the Worker on :$port…'; until curl -fs -o /dev/null http://localhost:$port/health; do sleep 1; done; pnpm dev:mobile" C-m

# Metro's QR code and keys want the room and the focus.
tmux select-pane -t "$mobile"
attach
