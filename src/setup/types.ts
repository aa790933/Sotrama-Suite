export interface SetupWizardOptions {
  logo: string | null;
  companyName: string;
  country: string;
  fullname: string;
  email: string;
  bankName: string;
  currency: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  chartOfAccounts: string;
}

import type { MariaDBConfig } from 'utils/mariadb-types';

export type HostType = 'host' | 'client';

export type ConnectionConfig = MariaDBConfig;

export interface HostSetupOptions {
  hostType: HostType;
  port: number;
  rootPassword: string;
  connection: ConnectionConfig;
  installForMe: boolean;
  remember: boolean;
}
