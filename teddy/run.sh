#!/bin/sh
# Options are read by the program from /data/options.json; SUPERVISOR_TOKEN comes from the Supervisor.
echo "Teddy starting"
exec python3 -u -m teddy.ear
