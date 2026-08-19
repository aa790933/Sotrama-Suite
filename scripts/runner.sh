#! /usr/bin/env zsh

# uses electron's node binary so native Node addons share the same
# NODE_MODULE_VERSION as the running Electron, avoiding ABI mismatches.

export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'
export ELECTRON_RUN_AS_NODE=true
alias electron_node="./node_modules/.bin/electron --require ts-node/register --require tsconfig-paths/register"
electron_node $@