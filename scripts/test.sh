set -o pipefail

TEST_PATH=$@

if [ $# -eq 0 ]
  then
    # IPC boundary specs live beside their production modules, not in tests/.
    TEST_PATH='./**/tests/**/*.spec.ts ./main/ipc/*.spec.ts ./tests/hostClient.flow.spec.ts'
fi

export IS_TEST=true
node ./scripts/verify-csv-parser.mjs || exit $?
node ./scripts/verify-translation-generator.mjs || exit $?
node --experimental-strip-types ./scripts/verify-rust-utility-bridge.mjs || exit $?
node --experimental-strip-types ./scripts/verify-rust-api-client.mjs || exit $?
node --experimental-strip-types ./scripts/verify-main-external-url.mjs || exit $?
node --experimental-strip-types ./scripts/verify-print-document-policy.mjs || exit $?
node ./scripts/verify-preload-bridge.mjs || exit $?
node ./scripts/verify-typed-renderer.mjs || exit $?
node ./scripts/verify-rust-patch-parity.mjs || exit $?
node ./scripts/verify-rust-backend-boundaries.mjs || exit $?
bash ./scripts/runner.sh ./node_modules/.bin/tape $TEST_PATH | ./node_modules/.bin/tap-spec
