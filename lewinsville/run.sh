#!/bin/sh
# Options from the add-on config become environment; SUPERVISOR_TOKEN is provided by the Supervisor.
OPTS=/data/options.json
export ANTHROPIC_API_KEY="$(jq -r '.anthropic_api_key // empty' $OPTS)"
export CLAUDE_MODEL="$(jq -r '.claude_model // "claude-opus-5-5"' $OPTS)"
export LOG_DIR=/share/lewinsville
export DEV_USER_EMAIL="$(jq -r '.dev_user_email // empty' $OPTS)"
export ENERGY_RATE_CENTS="$(jq -r '.energy_rate_cents // 0' $OPTS)"
export PORTAL_PEOPLE="$(jq -r '[.people[]? | "\(.email)=\(.name):\(.role):\(.theme // "festival")"] | join(",")' $OPTS)"
echo "Lewinsville Portal starting (model $CLAUDE_MODEL, chat $([ -n "$ANTHROPIC_API_KEY" ] && echo on || echo off))"
exec node server.js
