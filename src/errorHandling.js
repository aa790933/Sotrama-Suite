import { t } from 'fyo';
import { truncate } from 'lodash';
import { showDialog } from 'src/utils/interactive';
import { fyo } from './initFyo';
import router from './router';
import { getErrorMessage, stringifyCircular } from './utils';
import { ModelNameEnum } from 'models/types';
function shouldNotStore(error) {
    const shouldLog = error.shouldStore ?? true;
    return !shouldLog;
}
export async function sendError(errorLogObj) {
    if (!errorLogObj.stack) {
        return;
    }
    errorLogObj.more ??= {};
    errorLogObj.more.path ??= router.currentRoute.value.fullPath;
    const body = {
        error_name: errorLogObj.name,
        message: errorLogObj.message,
        stack: errorLogObj.stack,
        platform: fyo.store.platform,
        version: fyo.store.appVersion,
        language: fyo.store.language,
        instance_id: fyo.store.instanceId,
        device_id: fyo.store.deviceId,
        open_count: fyo.store.openCount,
        country_code: fyo.singles.SystemSettings?.countryCode,
        more: stringifyCircular(errorLogObj.more),
    };
    if (fyo.store.isDevelopment) {
        // eslint-disable-next-line no-console
        console.log('sendError', body);
    }
    await ipc.sendError(JSON.stringify(body));
}
function getToastProps(errorLogObj) {
    const props = {
        message: errorLogObj.name ?? t `Error`,
        type: 'error',
        actionText: t `Report Error`,
        action: () => reportIssue(errorLogObj),
    };
    return props;
}
export function getErrorLogObject(error, more) {
    const { name, stack, message, cause } = error;
    if (cause) {
        more.cause = cause;
    }
    const errorLogObj = { name, stack, message, more };
    fyo.errorLog.push(errorLogObj);
    return errorLogObj;
}
export async function handleError(logToConsole, error, more = {}, notifyUser = true) {
    if (logToConsole) {
        // eslint-disable-next-line no-console
        console.error(error);
    }
    if (shouldNotStore(error)) {
        return;
    }
    const errorLogObj = getErrorLogObject(error, more);
    await sendError(errorLogObj);
    if (notifyUser) {
        const toastProps = getToastProps(errorLogObj);
        const { showToast } = await import('src/utils/interactive');
        showToast(toastProps);
    }
}
export async function handleErrorWithDialog(error, doc, reportError, dontThrow) {
    if (!(error instanceof Error)) {
        return;
    }
    const errorMessage = getErrorMessage(error, doc);
    await handleError(false, error, { errorMessage, doc });
    const label = getErrorLabel(error);
    const options = {
        title: label,
        detail: errorMessage,
        type: 'error',
    };
    if (reportError) {
        options.detail = truncate(String(options.detail), { length: 128 });
        options.buttons = [
            {
                label: t `Report`,
                action() {
                    reportIssue(getErrorLogObject(error, { errorMessage }));
                },
                isPrimary: true,
            },
            {
                label: t `Cancel`,
                action() {
                    return null;
                },
                isEscape: true,
            },
        ];
    }
    await showDialog(options);
    if (dontThrow) {
        if (fyo.store.isDevelopment) {
            // eslint-disable-next-line no-console
            console.error(error);
        }
        return;
    }
    throw error;
}
export async function showErrorDialog(title, content) {
    // To be used for  show stopper errors
    title ??= t `Error`;
    content ??= t `Something has gone terribly wrong. Please check the console and raise an issue.`;
    await ipc.showError(title, content);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getErrorHandled(func) {
    return async function errorHandled(...args) {
        try {
            return (await func(...args));
        }
        catch (error) {
            await handleError(false, error, {
                functionName: func.name,
                functionArgs: args,
            });
            throw error;
        }
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getErrorHandledSync(func) {
    return function errorHandledSync(...args) {
        try {
            return func(...args);
        }
        catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            handleError(false, error, {
                functionName: func.name,
                functionArgs: args,
            });
        }
    };
}
function getFeatureFlags() {
    const getBooleanFields = (docName) => {
        const doc = fyo.singles[docName];
        return Object.entries(doc).reduce((acc, [key, value]) => {
            const fieldsArray = fyo.schemaMap[docName]?.fields ?? [];
            const fieldsMap = new Map(fieldsArray.map((f) => [f.fieldname, f]));
            const field = fieldsMap.get(key);
            if (typeof value === 'boolean' &&
                !field?.hidden &&
                !key.startsWith('_')) {
                acc[key] = value;
            }
            return acc;
        }, {});
    };
    const sections = [
        {
            name: 'Accounting',
            flags: getBooleanFields(ModelNameEnum.AccountingSettings),
        },
        { name: 'POS', flags: getBooleanFields(ModelNameEnum.POSSettings) },
        {
            name: 'Inventory',
            flags: getBooleanFields(ModelNameEnum.InventorySettings),
        },
    ]
        .filter(({ flags }) => Object.keys(flags).length > 0)
        .flatMap(({ name, flags }) => [
        `**${name} Settings**:`,
        '```json',
        JSON.stringify(flags, null, 2),
        '```',
        '',
    ]);
    return sections.length
        ? [
            '<details>',
            '<summary><strong>Feature Flags</strong></summary>',
            '',
            ...sections,
            '</details>',
        ]
        : [];
}
function getIssueUrlQuery(errorLogObj) {
    const baseUrl = 'https://github.com/aa790933/Sotrama-Suite/issues/new?labels=bug';
    const body = [
        '<h2>Description</h2>',
        'Add some description...',
        '',
        '<h2>Steps to Reproduce</h2>',
        'Add steps to reproduce the error...',
        '',
        '<h2>Info</h2>',
        '',
    ];
    if (errorLogObj) {
        body.push(`**Error**: _${errorLogObj.name}: ${errorLogObj.message}_`, '');
    }
    if (errorLogObj?.stack) {
        body.push('**Stack**:', '```', errorLogObj.stack, '```', '');
    }
    body.push(`**Version**: \`${fyo.store.appVersion}\``);
    body.push(`**Platform**: \`${fyo.store.platform}\``);
    body.push(`**Path**: \`${router.currentRoute.value.fullPath}\``);
    body.push(`**Language**: \`${fyo.config.get('language') ?? '-'}\``);
    if (fyo.singles.SystemSettings?.countryCode) {
        body.push(`**Country**: \`${fyo.singles.SystemSettings.countryCode}\``);
    }
    body.push('', ...getFeatureFlags());
    const encodedBody = encodeURIComponent(body.join('\n'));
    return `${baseUrl}&body=${encodedBody}`;
}
export function reportIssue(errorLogObj) {
    const urlQuery = getIssueUrlQuery(errorLogObj);
    ipc.openExternalUrl(urlQuery);
}
function getErrorLabel(error) {
    const name = error.name;
    if (!name) {
        return t `Error`;
    }
    if (name === 'BaseError') {
        return t `Error`;
    }
    if (name === 'ValidationError') {
        return t `Validation Error`;
    }
    if (name === 'NotFoundError') {
        return t `Not Found`;
    }
    if (name === 'ForbiddenError') {
        return t `Forbidden Error`;
    }
    if (name === 'DuplicateEntryError') {
        return t `Duplicate Entry`;
    }
    if (name === 'LinkValidationError') {
        return t `Link Validation Error`;
    }
    if (name === 'MandatoryError') {
        return t `Mandatory Error`;
    }
    if (name === 'DatabaseError') {
        return t `Database Error`;
    }
    if (name === 'CannotCommitError') {
        return t `Cannot Commit Error`;
    }
    if (name === 'NotImplemented') {
        return t `Error`;
    }
    if (name === 'ToDebugError') {
        return t `Error`;
    }
    return t `Error`;
}
