set -o pipefail

TEST_PATH=$@

if [ $# -eq 0 ]
  then
    # IPC boundary specs live beside their production modules, not in tests/.
    TEST_PATH='./**/tests/**/*.spec.ts ./main/ipc/*.spec.ts ./tests/hostClient.flow.spec.ts'
fi

export IS_TEST=true
node --experimental-strip-types ./scripts/verify-csv-parser.ts || exit $?
node --experimental-strip-types ./scripts/verify-translation-generator.ts || exit $?
node --experimental-strip-types ./scripts/verify-rust-utility-bridge.ts || exit $?
node --experimental-strip-types ./scripts/verify-rust-api-client.ts || exit $?
node --experimental-strip-types ./scripts/verify-main-external-url.ts || exit $?
node --experimental-strip-types ./scripts/verify-print-document-policy.ts || exit $?
node --experimental-strip-types ./scripts/verify-preload-bridge.ts || exit $?
node --experimental-strip-types ./scripts/verify-typed-renderer.ts || exit $?
node --experimental-strip-types ./scripts/verify-rust-patch-parity.ts || exit $?
node --experimental-strip-types ./scripts/verify-rust-backend-boundaries.ts || exit $?
bash ./scripts/runner.sh ./node_modules/.bin/tape $TEST_PATH | ./node_modules/.bin/tap-spec
