import { Fyo } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import {
  AccountRootType,
  COAChildAccount,
  COARootAccount,
  COATree,
} from 'models/baseModels/Account/types';
import { getCOAList } from 'models/baseModels/SetupWizard/SetupWizard';
import { getStandardCOA } from './standardCOA';

const accountFields = ['accountType', 'accountNumber', 'rootType', 'isGroup'];

export class CreateCOA {
  fyo: Fyo;
  chartOfAccounts: string;

  constructor(chartOfAccounts: string, fyo: Fyo) {
    this.chartOfAccounts = chartOfAccounts;
    this.fyo = fyo;
  }

  async run() {
    const chart = await getCOA(this.chartOfAccounts);
    await this.createCOAAccounts(chart, null, '', true);
  }

  async createCOAAccounts(
    children: COATree | COARootAccount | COAChildAccount,
    parentAccount: string | null,
    rootType: AccountRootType | '',
    rootAccount: boolean
  ) {
    for (const rootName in children) {
      if (accountFields.includes(rootName)) {
        continue;
      }

      const child = children[rootName];

      if (rootAccount) {
        rootType = (child as COARootAccount).rootType;
      }

      const accountType = (child as COAChildAccount).accountType ?? '';
      const accountNumber = (child as COAChildAccount).accountNumber;
      const accountName = getAccountName(rootName, accountNumber);

      const isGroup = identifyIsGroup(
        child as COAChildAccount | COARootAccount
      );

      if (await this.fyo.db.exists('Account', accountName)) {
        const existing = await this.fyo.db.get('Account', accountName);
        const matchesChart =
          (existing.parentAccount ?? null) === (parentAccount ?? null) &&
          existing.rootType === rootType &&
          (existing.accountType ?? '') === accountType &&
          Boolean(existing.isGroup) === isGroup;

        if (!matchesChart) {
          throw new ValidationError(
            this.fyo
              .t`Account ${accountName} already exists with a different parent or account type.`
          );
        }
      } else {
        const doc = this.fyo.doc.getNewDoc('Account', {
          name: accountName,
          parentAccount,
          isGroup,
          rootType,
          accountType,
        });

        await doc.sync();
      }
      await this.createCOAAccounts(
        child as COAChildAccount,
        accountName,
        rootType,
        false
      );
    }
  }
}

function identifyIsGroup(child: COARootAccount | COAChildAccount): boolean {
  if (child.isGroup !== undefined) {
    return child.isGroup as boolean;
  }

  const keys = Object.keys(child);
  const children = keys.filter((key) => !accountFields.includes(key));

  if (children.length) {
    return true;
  }

  return false;
}

async function getCOA(chartOfAccounts: string): Promise<COATree> {
  const coaList = getCOAList();
  const coa = coaList.find(({ name }) => name === chartOfAccounts);

  const conCode = coa?.countryCode;
  if (!conCode) {
    return getStandardCOA();
  }

  try {
    const countryCoaModule = (await import(
      `../../fixtures/verified/${conCode}.json`
    )) as { default: { tree: COATree } };
    return countryCoaModule.default.tree;
  } catch {
    return getStandardCOA();
  }
}

function getAccountName(accountName: string, accountNumber?: string) {
  if (accountNumber) {
    return `${accountName} - ${accountNumber}`;
  }

  return accountName;
}
