#!/usr/bin/env bash
# make all / all-down / all-restart: the whole local stack in one tmux session "fielder", one pane per server:
#   left top: the Worker (:8787) · left bottom: the dashboard (:5173) · right: make mobile (tunnel + Metro).
# The mobile pane waits for the Worker, so mobile.sh only adds a tunnel to it (one Worker, one local D1).
#   up (default)  start it, or attach when it is already running
#   down          Ctrl-C every pane, close the session, then stop whatever of this repo still holds the ports
#   restart       down, then up
# Ctrl-C in a pane stops just that server.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
session="${SESSION:-fielder}"
port="${PORT:-8787}"
# Worker, dashboard, Metro.
ports=("$port" 5173 8081)

command -v tmux >/dev/null || { echo "tmux is not installed (sudo apt install tmux)." >&2; exit 1; }

attach() { if [ -n "${TMUX:-}" ]; then tmux switch-client -t "$session"; else tmux attach -t "$session"; fi; }

# True while a pane still runs something other than its shell.
busy() { tmux list-panes -t "$session" -F '#{pane_dead} #{pane_current_command}' 2>/dev/null | grep -qvE '^(1 |0 (bash|zsh|sh|fish)$)'; }

up() {
  if tmux has-session -t "$session" 2>/dev/null; then
    echo "The session \"$session\" is already running; attaching."
    attach
    return
  fi

  # A server that exits keeps its pane open, so its last error stays readable.
  tmux new-session -d -s "$session" -n stack -c "$root" -x "$(tput cols 2>/dev/null || echo 200)" -y "$(tput lines 2>/dev/null || echo 50)"
  tmux set-option -t "$session" remain-on-exit on
  tmux set-option -t "$session" mouse on
  tmux set-option -t "$session" pane-border-status top
  tmux set-option -t "$session" pane-border-format " #{pane_title} "

  local worker mobile dashboard
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
}

down() {
  if tmux has-session -t "$session" 2>/dev/null; then
    # Ctrl-C first, so Metro, the tunnel and wrangler shut down cleanly (mobile.sh stops its tunnel on exit).
    for p in $(tmux list-panes -t "$session" -F '#{pane_id}'); do tmux send-keys -t "$p" C-c; done
    for _ in $(seq 1 20); do busy || break; sleep 0.5; done
    tmux kill-session -t "$session"
    echo "Closed the tmux session \"$session\"."
  fi

  # Leftovers started from this repo (a crashed pane's child, a stray tunnel): what still listens on
  # the stack's ports, and cloudflared by its process name. Nothing is matched by command line, and
  # processes of other folders are left alone.
  local left=() cand=()
  for p in "${ports[@]}"; do
    cand+=($(ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 || true))
  done
  cand+=($(pgrep -u "$(id -u)" -x cloudflared || true))
  for pid in $(printf '%s\n' "${cand[@]}" | sort -u); do
    case "$(readlink "/proc/$pid/cwd" 2>/dev/null)" in "$root"*) left+=("$pid") ;; esac
  done
  if [ ${#left[@]} -gt 0 ]; then
    kill "${left[@]}" 2>/dev/null || true
    sleep 1
    kill -9 "${left[@]}" 2>/dev/null || true
    echo "Stopped ${#left[@]} leftover process(es) of this repo."
  fi

  local held=()
  for p in "${ports[@]}"; do (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && held+=("$p"); done
  if [ ${#held[@]} -gt 0 ]; then echo "Still in use (not by this repo): ${held[*]}" >&2; else echo "Ports ${ports[*]} are free."; fi
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  restart) down; up ;;
  *) echo "usage: $0 [up|down|restart]" >&2; exit 2 ;;
esac
