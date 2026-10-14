"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const csvParser_1 = require("../utils/csvParser");
let translationHelpers_1;
const translationsFolder = path_1.default.resolve(__dirname, '..', 'translations');
const PATTERN = /(?<!\w)t`([^`]+)`/g;
function shouldIgnore(p, ignoreList) {
    const name = p.split(path_1.default.sep).at(-1) ?? '';
    return ignoreList.includes(name);
}
async function getFileList(root, ignoreList, extPattern = /\.(js|ts|vue)$/) {
    const contents = await promises_1.default.readdir(root);
    const files = [];
    const promises = [];
    for (const c of contents) {
        const absPath = path_1.default.resolve(root, c);
        const isDir = (await promises_1.default.stat(absPath)).isDirectory();
        if (isDir && !shouldIgnore(absPath, ignoreList)) {
            const pr = getFileList(absPath, ignoreList, extPattern).then((fl) => {
                files.push(...fl);
            });
            promises.push(pr);
        }
        else if (absPath.match(extPattern) !== null) {
            files.push(absPath);
        }
    }
    await Promise.all(promises);
    return files;
}
async function getFileContents(fileList) {
    const contents = [];
    const promises = [];
    for (const fileName of fileList) {
        const pr = promises_1.default.readFile(fileName, { encoding: 'utf-8' }).then((content) => {
            contents.push({ fileName, content });
        });
        promises.push(pr);
    }
    await Promise.all(promises);
    return contents;
}
async function getAllTStringsMap(contents) {
    const strings = new Map();
    const promises = [];
    contents.forEach(({ fileName, content }) => {
        const pr = getTStrings(content).then((ts) => {
            if (ts.length === 0) {
                return;
            }
            strings.set(fileName, ts);
        });
        promises.push(pr);
    });
    await Promise.all(promises);
    return strings;
}
function getTStrings(content) {
    return new Promise((resolve) => {
        const tStrings = tStringFinder(content);
        resolve(tStrings);
    });
}
function tStringFinder(content) {
    return [...content.matchAll(PATTERN)].map(([, t]) => {
        t = (0, translationHelpers_1.getIndexFormat)(t);
        return (0, translationHelpers_1.getWhitespaceSanitized)(t);
    });
}
function tStringsToArray(tMap, tStrings) {
    const tSet = new Set();
    for (const k of tMap.keys()) {
        tMap.get(k).forEach((s) => tSet.add(s));
    }
    for (const ts of tStrings) {
        tSet.add(ts);
    }
    return Array.from(tSet).sort();
}
function printHelp() {
    const shouldPrint = process.argv.findIndex((i) => i === '-h') !== -1;
    if (shouldPrint) {
        console.log(`Usage: ` +
            `\tyarn script:translate\n` +
            `\tyarn script:translate -h\n` +
            `\tyarn script:translate -l [language_code]\n` +
            `\n` +
            `Example: $ yarn script:translate -l de\n` +
            `\n` +
            `Description:\n` +
            `\tPassing a language code will create a '.csv' file in\n` +
            `\tthe 'translations' subdirectory. Translated strings are to\n` +
            `\tbe added to this file.\n\n` +
            `\tCalling the script without args will update the translation csv\n` +
            `\tfile with new strings if any. Existing translations won't\n` +
            `\tbe removed.\n` +
            `\n` +
            `Parameters:\n` +
            `\tlanguage_code : An ISO 693-1 code or a locale identifier.\n` +
            `\n` +
            `Reference:\n` +
            `\tISO 693-1 codes: https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes\n` +
            `\tLocale identifier: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl#locale_identification_and_negotiation`);
    }
    return shouldPrint;
}
function getLanguageCode() {
    const i = process.argv.findIndex((i) => i === '-l');
    if (i === -1) {
        return '';
    }
    return process.argv[i + 1] ?? '';
}
function getTranslationFilePath(languageCode) {
    return path_1.default.resolve(translationsFolder, `${languageCode}.csv`);
}
async function regenerateTranslation(tArray, path) {
    // Removes old strings, adds new strings
    const storedCSV = await promises_1.default.readFile(path, { encoding: 'utf-8' });
    const storedMatrix = (0, csvParser_1.parseCSV)(storedCSV);
    const map = new Map();
    for (const row of storedMatrix) {
        const tstring = row[0];
        map.set(tstring, row.slice(1));
    }
    const matrix = tArray.map((source) => {
        const stored = map.get(source) ?? [];
        const translation = stored[0] ?? '';
        const context = stored[1] ?? '';
        return [source, translation, context];
    });
    const csv = (0, csvParser_1.generateCSV)(matrix);
    await promises_1.default.writeFile(path, csv, { encoding: 'utf-8' });
    console.log(`\tregenerated: ${path}`);
}
async function regenerateTranslations(languageCode, tArray) {
    // regenerate one file
    if (languageCode.length !== 0) {
        const path = getTranslationFilePath(languageCode);
        await regenerateTranslation(tArray, path);
        return;
    }
    // regenerate all translation files
    console.log(`Language code not passed, regenerating all translations.`);
    for (const filePath of await promises_1.default.readdir(translationsFolder)) {
        if (!filePath.endsWith('.csv')) {
            continue;
        }
        await regenerateTranslation(tArray, path_1.default.resolve(translationsFolder, filePath));
    }
}
async function writeTranslations(languageCode, tArray) {
    const path = getTranslationFilePath(languageCode);
    try {
        const stat = await promises_1.default.stat(path);
        if (!stat.isFile()) {
            throw new Error(`${path} is not a translation file`);
        }
        console.log(`Existing file found for '${languageCode}': ${path}\n` +
            `regenerating it's translations.`);
        await regenerateTranslations(languageCode, tArray);
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
        const matrix = tArray.map((s) => [s, '', '']);
        const csv = (0, csvParser_1.generateCSV)(matrix);
        await promises_1.default.writeFile(path, csv, { encoding: 'utf-8' });
        console.log(`Generated translation file for '${languageCode}': ${path}`);
    }
}
async function getTStringsFromJsonFileList(fileList) {
    const promises = [];
    const schemaTStrings = [];
    for (const filePath of fileList) {
        const promise = promises_1.default
            .readFile(filePath, { encoding: 'utf8' })
            .then((content) => {
            const schema = JSON.parse(content);
            const tStrings = [];
            pushTStringsFromSchema(schema, tStrings, translationHelpers_1.schemaTranslateables);
            return tStrings;
        })
            .then((ts) => {
            schemaTStrings.push(ts);
        });
        promises.push(promise);
    }
    await Promise.all(promises);
    return schemaTStrings.flat();
}
function pushTStringsFromSchema(map, array, translateables) {
    if (Array.isArray(map)) {
        for (const item of map) {
            pushTStringsFromSchema(item, array, translateables);
        }
        return;
    }
    if (typeof map !== 'object') {
        return;
    }
    for (const key of Object.keys(map)) {
        const value = map[key];
        if (translateables.includes(key) && typeof value === 'string') {
            array.push(value);
        }
        if (typeof value !== 'object') {
            continue;
        }
        pushTStringsFromSchema(value, array, translateables);
    }
}
async function getSchemaTStrings() {
    const root = path_1.default.resolve(__dirname, '../schemas');
    const fileList = await getFileList(root, ['tests'], /\.json$/);
    return await getTStringsFromJsonFileList(fileList);
}
async function run() {
    // Load the shared ESM helper in Node and renderer contexts alike.
    translationHelpers_1 = await import("../utils/translationHelpers.mjs");
    if (printHelp()) {
        return;
    }
    const root = path_1.default.resolve(__dirname, '..');
    const ignoreList = ['node_modules', 'dist_electron', 'scripts'];
    const languageCode = getLanguageCode();
    console.log();
    const fileList = await getFileList(root, ignoreList);
    const contents = await getFileContents(fileList);
    const tMap = await getAllTStringsMap(contents);
    const schemaTStrings = await getSchemaTStrings();
    const tArray = tStringsToArray(tMap, schemaTStrings);
    try {
        await promises_1.default.stat(translationsFolder);
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
        await promises_1.default.mkdir(translationsFolder);
    }
    if (languageCode === '') {
        await regenerateTranslations('', tArray);
        return;
    }
    await writeTranslations(languageCode, tArray);
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
