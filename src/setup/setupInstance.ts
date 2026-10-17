import { Fyo } from 'fyo';
import { DocValueMap } from 'fyo/core/types';
import { Doc } from 'fyo/model/doc';
import { createNumberSeries } from 'fyo/model/naming';
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_SERIES_START,
} from 'fyo/utils/consts';
import {
  AccountRootTypeEnum,
  AccountTypeEnum,
} from 'models/baseModels/Account/types';
import { AccountingSettings } from 'models/baseModels/AccountingSettings/AccountingSettings';
import { numberSeriesDefaultsMap } from 'models/baseModels/Defaults/Defaults';
import { InventorySettings } from 'models/inventory/InventorySettings';
import { ValuationMethod } from 'models/inventory/types';
import { ModelNameEnum } from 'models/types';
import { createRegionalRecords } from 'src/regional';
import {
  initializeInstance,
  setCurrencySymbols,
} from 'src/utils/initialization';
import { getRandomString } from 'utils';
import { getDefaultLocations, getDefaultUOMs } from 'utils/defaults';
import { getCountryCodeFromCountry, getCountryInfo } from 'utils/misc';
import { CountryInfo } from 'utils/types';
import { CreateCOA } from './createCOA';
import { SetupWizardOptions } from './types';

export default async function setupInstance(
  dbPath: string,
  setupWizardOptions: SetupWizardOptions,
  fyo: Fyo
) {
  const { companyName, country, bankName, chartOfAccounts } =
    setupWizardOptions;

  fyo.store.skipTelemetryLogging = true;
  await initializeDatabase(dbPath, country, fyo);
  await updateSystemSettings(setupWizardOptions, fyo);
  await updateAccountingSettings(setupWizardOptions, fyo);
  await updatePrintSettings(setupWizardOptions, fyo);

  await createCurrencyRecords(fyo);
  await createAccountRecords(bankName, country, chartOfAccounts, fyo);
  await ensureDefaultPaymentMethods(fyo);
  await createRegionalRecords(country, fyo);
  await createDefaultEntries(fyo);
  await createDefaultNumberSeries(fyo);
  await updateInventorySettings(fyo);

  if (fyo.isElectron) {
    const { updatePrintTemplates } = await import('src/utils/printTemplates');
    await updatePrintTemplates(fyo);
  }

  await completeSetup(companyName, fyo);
  if (!Object.keys(fyo.currencySymbols).length) {
    await setCurrencySymbols(fyo);
  }

  fyo.store.skipTelemetryLogging = false;
}

async function ensureDefaultPaymentMethods(fyo: Fyo) {
  const accounts = (await fyo.db.getAllRaw(ModelNameEnum.Account, {
    fields: ['name', 'accountType', 'isGroup'],
    filters: {
      accountType: ['in', [AccountTypeEnum.Cash, AccountTypeEnum.Bank]],
      isGroup: false,
    },
  })) as { name: string; accountType: AccountTypeEnum }[];

  const cashAccount = accounts.find(
    ({ accountType }) => accountType === AccountTypeEnum.Cash
  )?.name;
  const bankAccount = accounts.find(
    ({ accountType }) => accountType === AccountTypeEnum.Bank
  )?.name;

  const methods = [
    { name: 'Cash', type: 'Cash', account: cashAccount },
    { name: 'Bank', type: 'Bank', account: bankAccount },
    { name: 'Transfer', type: 'Bank', account: bankAccount },
  ];

  for (const method of methods) {
    if (!(await fyo.db.exists(ModelNameEnum.PaymentMethod, method.name))) {
      await fyo.doc.getNewDoc(ModelNameEnum.PaymentMethod, method).sync();
      continue;
    }

    const doc = await fyo.doc.getDoc(ModelNameEnum.PaymentMethod, method.name);
    const currentAccount = doc.get('account') as string | undefined;
    let currentAccountIsUsable = false;
    if (
      currentAccount &&
      (await fyo.db.exists(ModelNameEnum.Account, currentAccount))
    ) {
      const linkedAccount = await fyo.db.get(
        ModelNameEnum.Account,
        currentAccount
      );
      const expectedAccountType =
        method.type === 'Cash' ? AccountTypeEnum.Cash : AccountTypeEnum.Bank;
      currentAccountIsUsable =
        !Boolean(linkedAccount.isGroup) &&
        (linkedAccount.accountType as AccountTypeEnum) === expectedAccountType;
    }
    const updates: Record<string, string> = {};

    if (!doc.type) {
      updates.type = method.type;
    }
    if (!currentAccountIsUsable && method.account) {
      updates.account = method.account;
    }

    if (Object.keys(updates).length) {
      await doc.setAndSync(updates);
    }
  }
}

async function createDefaultEntries(fyo: Fyo) {
  /**
   * Create default UOM entries
   */
  for (const uom of getDefaultUOMs(fyo)) {
    await checkAndCreateDoc(ModelNameEnum.UOM, uom, fyo);
  }

  for (const loc of getDefaultLocations(fyo)) {
    await checkAndCreateDoc(ModelNameEnum.Location, loc, fyo);
  }
}

async function initializeDatabase(dbPath: string, country: string, fyo: Fyo) {
  const countryCode = getCountryCodeFromCountry(country);
  await initializeInstance(dbPath, true, countryCode, fyo);
}

async function updateAccountingSettings(
  {
    companyName,
    country,
    fullname,
    email,
    bankName,
    fiscalYearStart,
    fiscalYearEnd,
  }: SetupWizardOptions,
  fyo: Fyo
) {
  const accountingSettings = (await fyo.doc.getDoc(
    'AccountingSettings'
  )) as AccountingSettings;
  await accountingSettings.setAndSync({
    // Root accounts have no parent; only mark setup complete after the full wizard succeeds.
    setupComplete: false,
    companyName,
    country,
    fullname,
    email,
    bankName,
    fiscalYearStart,
    fiscalYearEnd,
  });
  return accountingSettings;
}

async function updatePrintSettings(
  { logo, companyName, email }: SetupWizardOptions,
  fyo: Fyo
) {
  const printSettings = await fyo.doc.getDoc('PrintSettings');
  await printSettings.setAndSync({
    logo,
    companyName,
    email,
    displayLogo: logo ? true : false,
  });
}

async function updateSystemSettings(
  { country, currency: companyCurrency }: SetupWizardOptions,
  fyo: Fyo
) {
  const countryInfo = getCountryInfo();
  const countryOptions = countryInfo[country] as CountryInfo;
  const currency =
    companyCurrency ?? countryOptions.currency ?? DEFAULT_CURRENCY;
  const locale = countryOptions.locale ?? DEFAULT_LOCALE;
  const countryCode = getCountryCodeFromCountry(country);
  const systemSettings = await fyo.doc.getDoc('SystemSettings');
  const instanceId = getRandomString();

  await systemSettings.setAndSync({
    locale,
    currency,
    instanceId,
    countryCode,
  });
}

async function createCurrencyRecords(fyo: Fyo) {
  const promises: Promise<Doc | undefined>[] = [];
  const queue: string[] = [];
  const countrySettings = Object.values(getCountryInfo()) as CountryInfo[];

  for (const country of countrySettings) {
    const {
      currency,
      currency_fraction,
      currency_fraction_units,
      smallest_currency_fraction_value,
      currency_symbol,
    } = country;

    if (!currency || queue.includes(currency)) {
      continue;
    }

    const docObject = {
      name: currency,
      fraction: currency_fraction ?? '',
      fractionUnits: currency_fraction_units ?? 100,
      smallestValue: smallest_currency_fraction_value ?? 0.01,
      symbol: currency_symbol ?? '',
    };

    const doc = checkAndCreateDoc('Currency', docObject, fyo);
    promises.push(doc);
    queue.push(currency);
  }
  return Promise.all(promises);
}

async function createAccountRecords(
  bankName: string,
  country: string,
  chartOfAccounts: string,
  fyo: Fyo
) {
  const createCOA = new CreateCOA(chartOfAccounts, fyo);
  await createCOA.run();
  const parentAccount = await getBankAccountParentName(country, fyo);
  const bankAccountDoc = {
    name: bankName,
    rootType: AccountRootTypeEnum.Asset,
    parentAccount,
    accountType: 'Bank',
    isGroup: false,
  };

  await checkAndCreateDoc('Account', bankAccountDoc, fyo);
  await createDiscountAccount(fyo);
  await setDefaultAccounts(fyo);
}

export async function createDiscountAccount(fyo: Fyo) {
  const incomeAccountName = fyo.t`Indirect Income`;
  const accountExists = await fyo.db.exists(
    ModelNameEnum.Account,
    incomeAccountName
  );

  if (!accountExists) {
    return;
  }

  const discountAccountName = fyo.t`Discounts`;
  const discountAccountDoc = {
    name: discountAccountName,
    rootType: AccountRootTypeEnum.Income,
    parentAccount: incomeAccountName,
    accountType: 'Income Account',
    isGroup: false,
  };

  await checkAndCreateDoc(ModelNameEnum.Account, discountAccountDoc, fyo);
  await fyo.singles.AccountingSettings!.setAndSync(
    'discountAccount',
    discountAccountName
  );
}

async function setDefaultAccounts(fyo: Fyo) {
  await setDefaultAccount('writeOffAccount', fyo.t`Write Off`, fyo);
  const isSet = await setDefaultAccount(
    'roundOffAccount',
    fyo.t`Rounded Off`,
    fyo
  );

  if (!isSet) {
    await setDefaultAccount('roundOffAccount', fyo.t`Round Off`, fyo);
  }
}

async function setDefaultAccount(key: string, accountName: string, fyo: Fyo) {
  const accountExists = await fyo.db.exists(ModelNameEnum.Account, accountName);
  if (!accountExists) {
    return false;
  }

  await fyo.singles.AccountingSettings!.setAndSync(key, accountName);
  return true;
}

async function completeSetup(companyName: string, fyo: Fyo) {
  await fyo.singles.AccountingSettings!.setAndSync('setupComplete', true);
}

async function checkAndCreateDoc(
  schemaName: string,
  docObject: DocValueMap,
  fyo: Fyo
): Promise<Doc | undefined> {
  const canCreate = await checkIfExactRecordAbsent(schemaName, docObject, fyo);
  if (!canCreate) {
    return;
  }

  const doc = fyo.doc.getNewDoc(schemaName, docObject);
  return doc.sync();
}

async function checkIfExactRecordAbsent(
  schemaName: string,
  docMap: DocValueMap,
  fyo: Fyo
) {
  const name = docMap.name as string;
  const newDocObject = Object.assign({}, docMap);

  const rows = await fyo.db.getAllRaw(schemaName, {
    fields: ['*'],
    filters: { name },
  });

  if (rows.length === 0) {
    return true;
  }

  const storedDocObject = rows[0];
  const matchList = Object.keys(newDocObject).map((key) => {
    const newValue = newDocObject[key];
    const storedValue = storedDocObject[key];
    return newValue == storedValue; // Should not be type sensitive.
  });

  if (!matchList.every(Boolean)) {
    await fyo.db.delete(schemaName, name);
    return true;
  }

  return false;
}

async function getBankAccountParentName(country: string, fyo: Fyo) {
  const parentBankAccount = await fyo.db.getAllRaw('Account', {
    fields: ['*'],
    filters: { isGroup: true, accountType: 'Bank' },
  });

  if (parentBankAccount.length === 0) {
    // This should not happen if the fixtures are correct.
    return 'Bank Accounts';
  } else if (parentBankAccount.length > 1) {
    switch (country) {
      case 'Indonesia':
        return 'Bank Rupiah - 1121.000';
      default:
        break;
    }
  }

  return parentBankAccount[0].name;
}

async function createDefaultNumberSeries(fyo: Fyo) {
  const numberSeriesFields = Object.values(fyo.schemaMap)
    .map((f) => f?.fields)
    .flat()
    .filter((f) => f?.fieldname === 'numberSeries');

  for (const field of numberSeriesFields) {
    const defaultValue = field?.default as string | undefined;
    const schemaName = field?.schemaName;
    if (!defaultValue || !schemaName) {
      continue;
    }

    await createNumberSeries(
      defaultValue,
      schemaName,
      DEFAULT_SERIES_START,
      fyo
    );

    const defaultKey = numberSeriesDefaultsMap[schemaName];
    if (!defaultKey || fyo.singles.Defaults?.[defaultKey]) {
      continue;
    }

    await fyo.singles.Defaults?.setAndSync(defaultKey as string, defaultValue);
  }
}

async function updateInventorySettings(fyo: Fyo) {
  const inventorySettings = (await fyo.doc.getDoc(
    ModelNameEnum.InventorySettings
  )) as InventorySettings;

  if (!inventorySettings.valuationMethod) {
    await inventorySettings.set('valuationMethod', ValuationMethod.FIFO);
  }
  const accountTypeDefaultMap = {
    [AccountTypeEnum.Stock]: 'stockInHand',
    [AccountTypeEnum['Stock Received But Not Billed']]:
      'stockReceivedButNotBilled',
    [AccountTypeEnum['Cost of Goods Sold']]: 'costOfGoodsSold',
  } as Record<string, string>;

  for (const accountType in accountTypeDefaultMap) {
    const accounts = (await fyo.db.getAllRaw('Account', {
      filters: { accountType, isGroup: false },
    })) as { name: string }[];

    if (!accounts.length) {
      continue;
    }

    const settingName = accountTypeDefaultMap[accountType];
    await inventorySettings.set(settingName, accounts[0].name);
  }

  const location = fyo.t`Stores`;
  if (await fyo.db.exists(ModelNameEnum.Location, location)) {
    await inventorySettings.set('defaultLocation', location);
  }

  await inventorySettings.sync();
}
