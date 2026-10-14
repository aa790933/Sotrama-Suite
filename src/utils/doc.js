export function evaluateReadOnly(field, doc) {
    if (doc?.inserted && field.fieldname === 'numberSeries') {
        return true;
    }
    if (field.fieldname === 'name' &&
        (doc?.inserted || doc?.schema.naming !== 'manual')) {
        return true;
    }
    if (doc?.isSubmitted || doc?.parentdoc?.isSubmitted) {
        return true;
    }
    if (doc?.isCancelled || doc?.parentdoc?.isCancelled) {
        return true;
    }
    return evaluateFieldMeta(field, doc, 'readOnly');
}
export function evaluateHidden(field, doc) {
    return evaluateFieldMeta(field, doc, 'hidden');
}
export function evaluateInvisible(field, doc) {
    return evaluateFieldMeta(field, doc, 'invisible');
}
export function evaluateRequired(field, doc) {
    return evaluateFieldMeta(field, doc, 'required');
}
function evaluateFieldMeta(field, doc, meta, defaultValue = false) {
    if (meta === undefined) {
        return defaultValue;
    }
    const value = field[meta];
    if (value !== undefined) {
        return value;
    }
    const docRecord = doc;
    const metaKey = meta;
    const metaObj = docRecord?.[metaKey];
    const evalFunction = metaObj?.[field.fieldname];
    if (typeof evalFunction === 'function') {
        return evalFunction();
    }
    return defaultValue;
}
export async function getLinkedEntries(doc) {
    // Full schemaMap walk, then one query per incoming Link/DynamicLink field.
    const fyo = doc.fyo;
    const target = doc.schemaName;
    const linkingFields = Object.values(fyo.schemaMap)
        .filter((sch) => !sch?.isSingle)
        .map((sch) => sch?.fields)
        .flat()
        .filter((f) => f?.fieldtype === 'Link' && f.target === target);
    const dynamicLinkingFields = Object.values(fyo.schemaMap)
        .filter((sch) => !sch?.isSingle)
        .map((sch) => sch?.fields)
        .flat()
        .filter((f) => f?.fieldtype === 'DynamicLink');
    const entries = {};
    const childEntries = {};
    for (const field of [linkingFields, dynamicLinkingFields].flat()) {
        if (!field.schemaName) {
            continue;
        }
        const options = {
            filters: { [field.fieldname]: doc.name },
            fields: ['name'],
        };
        if (field.fieldtype === 'DynamicLink') {
            options.filters[field.references] = doc.schemaName;
        }
        const schema = fyo.schemaMap[field.schemaName];
        if (schema?.isChild) {
            options.fields.push('parent', 'parentSchemaName');
        }
        else {
            options.fields?.push('created');
        }
        if (schema?.isSubmittable) {
            options.filters.cancelled = false;
        }
        const details = (await fyo.db.getAllRaw(field.schemaName, options));
        if (!details.length) {
            continue;
        }
        for (const d of details) {
            if ('parent' in d) {
                childEntries[field.schemaName] ??= [];
                childEntries[field.schemaName].push(d);
            }
            else {
                entries[field.schemaName] ??= [];
                entries[field.schemaName].push(d);
            }
        }
    }
    const parents = Object.values(childEntries)
        .flat()
        .map((c) => `${c.parentSchemaName}.${c.parent}`);
    const parentsSet = new Set(parents);
    for (const p of parentsSet) {
        const i = p.indexOf('.');
        const schemaName = p.slice(0, i);
        const name = p.slice(i + 1);
        const details = (await fyo.db.getAllRaw(schemaName, {
            filters: { name },
            fields: ['name', 'created'],
        }));
        entries[schemaName] ??= [];
        entries[schemaName].push(...details);
    }
    const entryMap = {};
    for (const schemaName in entries) {
        entryMap[schemaName] = entries[schemaName]
            .map((e) => ({ name: e.name, created: new Date(e.created) }))
            .sort((a, b) => b.created.valueOf() - a.created.valueOf())
            .map((e) => e.name);
    }
    return entryMap;
}
