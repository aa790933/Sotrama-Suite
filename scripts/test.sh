TEST_PATH=$@

if [ $# -eq 0 ]
  then
    # IPC boundary specs live beside their production modules, not in tests/.
    TEST_PATH='./**/tests/**/*.spec.ts ./main/ipc/*.spec.ts'
fi

export IS_TEST=true
node ./scripts/verify-csv-parser.mjs || exit $?
node ./scripts/verify-translation-generator.mjs || exit $?
bash ./scripts/runner.sh ./node_modules/.bin/tape $TEST_PATH | ./node_modules/.bin/tap-spec
