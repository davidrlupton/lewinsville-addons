#!/usr/bin/with-contenv bashio
# with-contenv: the base image's s6 init clears the environment for CMD, so without it SUPERVISOR_TOKEN is empty
# (seen 2026-11-08). Options are read by the program from /data/options.json.
echo "Teddy starting"
exec python3 -u -m teddy.ear
