#! /usr/bin/env bash

# Resolve .bin wrappers if passed to their actual JS entrypoint
SCRIPT="$1"
shift

if [ "$SCRIPT" = "./node_modules/.bin/tape" ] || [ "$SCRIPT" = "node_modules/.bin/tape" ]; then
  SCRIPT="./node_modules/tape/bin/tape"
fi

export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'
export TS_NODE_TRANSPILE_ONLY=true
export ELECTRON_RUN_AS_NODE=true

exec node -r ./node_modules/ts-node/register/transpile-only -r ./node_modules/tsconfig-paths/register "$SCRIPT" "$@"