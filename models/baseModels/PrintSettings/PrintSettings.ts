import { Attachment } from 'fyo/core/types';
import { Doc } from 'fyo/model/doc';
import { HiddenMap } from 'fyo/model/types';

export class PrintSettings extends Doc {
  logo?: Attachment;
  email?: string;
  phone?: string;
  address?: string;
  companyName?: string;
  color?: string;
  font?: string;
  displayLogo?: boolean;
  displayTime?: boolean;
  displayDescription?: boolean;
  displaytermsandconditions?: boolean;
  termsAndConditions?: string;
  posPrintWidth?: number;
  amountInWords?: boolean;
  headerMode?: string;
  headerContent?: string;
  headerHeight?: number;
  footerMode?: string;
  footerContent?: string;
  footerHeight?: number;
  showNifOnDocuments?: boolean;
  showNisOnDocuments?: boolean;
  showRcOnDocuments?: boolean;
  showCapitalSocialOnDocuments?: boolean;
  showCnasingEmployerOnDocuments?: boolean;
  override hidden: HiddenMap = {
    termsAndConditions: () => !this.displaytermsandconditions,
    showNifOnDocuments: () =>
      this.fyo.singles.SystemSettings?.countryCode !== 'dz',
    showNisOnDocuments: () =>
      this.fyo.singles.SystemSettings?.countryCode !== 'dz',
    showRcOnDocuments: () =>
      this.fyo.singles.SystemSettings?.countryCode !== 'dz',
    showCapitalSocialOnDocuments: () =>
      this.fyo.singles.SystemSettings?.countryCode !== 'dz',
    showCnasingEmployerOnDocuments: () =>
      this.fyo.singles.SystemSettings?.countryCode !== 'dz',
  };
}
