#!/bin/sh
set -e

SECRET_FILE="${SECRET_FILE:-/shared/secrets.env}"
CONFIG_JS="/usr/share/nginx/html/config.js"
CONFIG_JSON="/usr/share/nginx/html/config.json"

render_config() {
    SECRET=""
    if [ -f "$SECRET_FILE" ]; then
        SECRET="$(sed -n 's/^export[[:space:]]\+API_SECRET=//p' "$SECRET_FILE" | tail -n 1 | tr -d '\r')"
    fi
    if [ -z "$SECRET" ]; then
        SECRET="${API_SECRET:-}"
    fi
    # Atomic writes: write to temp files first, then mv (no empty-file race).
    printf 'window.APP_CONFIG = { apiKey: "%s" };\n' "$SECRET" > "${CONFIG_JS}.tmp"
    mv "${CONFIG_JS}.tmp" "$CONFIG_JS"
    printf '{"apiKey":"%s"}\n' "$SECRET" > "${CONFIG_JSON}.tmp"
    mv "${CONFIG_JSON}.tmp" "$CONFIG_JSON"
}

render_config

while true; do
    sleep 1
    render_config
done &

exit 0
