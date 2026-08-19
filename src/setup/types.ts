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

export type HostType = 'host' | 'connect';

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface HostSetupOptions {
  hostType: HostType;
  port: number;
  rootPassword: string;
  connection: ConnectionConfig;
  installForMe: boolean;
  remember: boolean;
}
