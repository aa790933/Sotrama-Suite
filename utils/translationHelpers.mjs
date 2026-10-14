import helpers from './translationHelpers.cjs';

// The synchronous CommonJS module is the implementation source because the
// legacy TypeScript test/runtime path loads it with require(). This ESM facade
// keeps browser/build tooling and the native Node translation generator on the
// same implementation without duplicating behavior.
export const schemaTranslateables = helpers.schemaTranslateables;
export const getIndexFormat = helpers.getIndexFormat;
export const getSnippets = helpers.getSnippets;
export const getWhitespaceSanitized = helpers.getWhitespaceSanitized;
export const getIndexList = helpers.getIndexList;
