#!/usr/bin/env bash
# make all / all-down / all-restart: the whole local stack in one tmux session "fielder":
#   left top: the Worker (:8787) · left bottom: the dashboard (:5173) · right: make mobile (tunnel + Metro)
#   bottom, full width: the control pane (which servers are up; r restarts them, q stops everything).
# The mobile pane waits for the Worker, so mobile.sh only adds a tunnel to it (one Worker, one local D1).
#   up (default)  start it, or attach when it is already running
#   down          Ctrl-C every server, stop what of this repo still holds the ports, close the session
#   restart       the servers again in their panes (the session and its layout stay); starts it when it is not up
#   control       the loop the control pane runs
# Ctrl-C in a server pane stops just that server; the shell stays, so it can be run again by hand.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
session="${SESSION:-fielder}"
port="${PORT:-8787}"
# Worker, dashboard, Metro.
ports=("$port" 5173 8081)
names=(worker dashboard mobile)

command -v tmux >/dev/null || { echo "tmux is not installed (sudo apt install tmux)." >&2; exit 1; }

running() { tmux has-session -t "$session" 2>/dev/null; }
attach() { if [ -n "${TMUX:-}" ]; then tmux switch-client -t "$session"; else tmux attach -t "$session"; fi; }
# The pane id stored for a role (@worker, @dashboard, @mobile, @control) when the session was made.
pane() { tmux show-option -qv -t "$session" "@$1"; }

# What each server pane runs (typed into its shell, so Ctrl-C leaves a prompt to run it again).
command_for() {
  case "$1" in
    worker) echo "pnpm dev:worker" ;;
    dashboard) echo "pnpm dev:dashboard" ;;
    mobile) echo "echo 'Waiting for the Worker on :$port…'; until curl -fs -o /dev/null http://localhost:$port/health; do sleep 1; done; pnpm dev:mobile" ;;
  esac
}

# True while a server pane still runs something other than its shell.
busy() {
  local n
  for n in "${names[@]}"; do
    tmux display-message -p -t "$(pane "$n")" '#{pane_dead} #{pane_current_command}' 2>/dev/null | grep -qvE '^(1 |0 (bash|zsh|sh|fish)$)' && return 0
  done
  return 1
}

# Ctrl-C to every server and wait (up to 10 s) for them to exit.
stop_servers() {
  local n
  for n in "${names[@]}"; do tmux send-keys -t "$(pane "$n")" C-c 2>/dev/null || true; done
  for _ in $(seq 1 20); do busy || break; sleep 0.5; done
}

# Leftovers started from this repo (a crashed pane's child, a stray tunnel): what still listens on
# the stack's ports, and cloudflared by its process name. Nothing is matched by command line, and
# processes of other folders are left alone.
sweep() {
  local left=() cand=() p pid
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
}

# A fresh shell in each server pane, with its command typed in.
start_servers() {
  local n
  for n in "${names[@]}"; do
    tmux respawn-pane -k -t "$(pane "$n")" -c "$root"
    tmux send-keys -t "$(pane "$n")" "$(command_for "$n")" C-m
  done
}

report() {
  local held=() p
  for p in "${ports[@]}"; do (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && held+=("$p"); done
  if [ ${#held[@]} -gt 0 ]; then echo "Still in use (not by this repo): ${held[*]}" >&2; else echo "Ports ${ports[*]} are free."; fi
}

up() {
  if running; then
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

  local worker mobile dashboard control kv n
  worker="$(tmux display-message -p -t "$session:stack" '#{pane_id}')"
  # The control strip first, across the full width at the bottom; then the servers above it.
  control="$(tmux split-window -v -f -l 3 -t "$worker" -c "$root" -P -F '#{pane_id}')"
  mobile="$(tmux split-window -h -t "$worker" -c "$root" -P -F '#{pane_id}')"
  dashboard="$(tmux split-window -v -t "$worker" -c "$root" -P -F '#{pane_id}')"
  for kv in "worker=$worker" "dashboard=$dashboard" "mobile=$mobile" "control=$control"; do tmux set-option -t "$session" "@${kv%%=*}" "${kv#*=}"; done

  tmux select-pane -t "$worker" -T "worker :$port"
  tmux select-pane -t "$dashboard" -T "dashboard :5173"
  tmux select-pane -t "$mobile" -T "mobile (tunnel + Metro)"
  tmux select-pane -t "$control" -T "control: click here, then r / q / d"

  for n in "${names[@]}"; do tmux send-keys -t "$(pane "$n")" "$(command_for "$n")" C-m; done
  tmux respawn-pane -k -t "$control" -c "$root" "bash '$root/scripts/dev-all.sh' control"

  # Metro's QR code and keys want the focus; the control pane is one click away.
  tmux select-pane -t "$mobile"
  attach
}

down() {
  if running; then
    stop_servers
    sweep
    report
    # Last: when this runs in the control pane, closing the session ends this script too.
    tmux kill-session -t "$session"
  else
    sweep
    report
  fi
}

restart() {
  if ! running; then up; return; fi
  stop_servers
  sweep
  start_servers
  echo "Restarted the servers in \"$session\"."
}

# The control pane: which servers answer (refreshed every 2 s), and one key per action.
control() {
  local key state p
  while true; do
    state=""
    for p in "$port:worker" "5173:dashboard" "8081:metro"; do
      if (exec 3<>"/dev/tcp/127.0.0.1/${p%%:*}") 2>/dev/null; then state+=" ● ${p#*:}"; else state+=" ○ ${p#*:}"; fi
    done
    printf '\r\033[2K%s   │  r restart  ·  q quit (stop all)  ·  d detach' "$state"
    key=""
    read -rsn1 -t 2 key || true
    case "$key" in
      r|R) printf '\r\033[2K Restarting the servers…'; restart >/dev/null 2>&1 || true ;;
      q|Q|x|X) printf '\r\033[2K Stopping everything…'; down >/dev/null 2>&1; exit 0 ;;
      d|D) tmux detach-client ;;
    esac
  done
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  restart) restart ;;
  control) control ;;
  *) echo "usage: $0 [up|down|restart]" >&2; exit 2 ;;
esac
