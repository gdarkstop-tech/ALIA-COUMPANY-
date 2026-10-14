#!/usr/bin/env bash
# Runs once when the Postgres container initialises an empty data directory.
set -euo pipefail
PSQL="psql -U ${POSTGRES_USER:-postgres}" bash /opt/ghayarly/db-bootstrap.sh
