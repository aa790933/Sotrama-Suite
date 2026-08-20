import { Doc } from 'fyo/model/doc';
import { ListViewSettings } from 'fyo/model/types';
import { accruedLeaveDays, leaveDurationDays } from './leaveAccrual';

export class LeaveApplication extends Doc {
  employee?: string;
  startDate?: Date;
  endDate?: Date;
  type?: string;
  status?: string;
  remark?: string;

  /**
   * Accrued leave entitlement (days) as of this leave's `startDate`,
   * computed from the employee's `hireDate` per the 2.5-days/month rule
   * (capped at 30 per Jul 1 – Jun 30 reference period).
   *
   * This is a pure projection; persisting a used-leave balance so requests
   * can be validated against remaining balance is a separate concern.
   */
  async getAccruedEntitlement(): Promise<number> {
    if (!this.employee || !this.startDate) {
      return 0;
    }
    const emp = (await this.loadAndGetLink('employee')) as {
      hireDate?: Date;
    } | null;
    const hire = emp?.hireDate;
    if (!hire) {
      return 0;
    }
    return accruedLeaveDays(hire, this.startDate);
  }

  /**
   * Total statutory annual-leave days already committed for this employee.
   *
   * "Used" is the inclusive-calendar-day duration of every Annual leave
   * application for the employee that has been submitted (`submitted == true`),
   * is not cancelled, and is not rejected. Draft / cancelled / rejected
   * requests do not reserve balance.
   *
   * The value is derived by querying the submitted approved/submitted leaves
   * directly — no separate counter field is persisted — so it stays consistent
   * under cancellation, rejection, and re-submission without risk of drift.
   */
  async getUsedAnnualLeaveDays(): Promise<number> {
    if (!this.employee) {
      return 0;
    }

    const leaves = await this.fyo.db.getAll('LeaveApplication', {
      fields: ['startDate', 'endDate', 'submitted', 'cancelled', 'status'],
      filters: { employee: this.employee, type: 'Annual' },
    });

    let used = 0;
    for (const lv of leaves) {
      const submitted = !!lv.submitted;
      const cancelled = !!lv.cancelled;
      const status = lv.status as string | undefined;
      // Only submitted, non-cancelled, non-rejected leaves reserve balance.
      if (!submitted || cancelled || status === 'Rejected') {
        continue;
      }
      const start = lv.startDate as Date | undefined;
      const end = lv.endDate as Date | undefined;
      if (start && end) {
        used += leaveDurationDays(start, end);
      }
    }
    return used;
  }

  /**
   * Remaining statutory annual-leave balance as of this leave's `startDate`:
   * `accrued - used`. Negative when the employee has been over-granted.
   */
  async getRemainingBalance(): Promise<number> {
    const accrued = await this.getAccruedEntitlement();
    const used = await this.getUsedAnnualLeaveDays();
    return accrued - used;
  }

  /**
   * Balance guard: blocks submitting a statutory **Annual** leave request when
   * it would leave the employee's annual-leave balance negative.
   *
   * Scope (per Algerian statutory annual-leave law): the guard fires ONLY for
   * `type === 'Annual'`. Casual, Sick, Emergency, Maternity and Paternity
   * leaves draw from other entitlements and are never blocked by this accrual
   * balance. Submitting an Annual request reserves its days immediately
   * (`submitted == true`), so `getRemainingBalance` decreases once submit
   * succeeds.
   */
  override async beforeSubmit(): Promise<void> {
    if (this.type !== 'Annual') {
      return;
    }

    if (!this.startDate || !this.endDate) {
      throw new Error(
        'LeaveApplication.beforeSubmit: startDate and endDate are required to validate the annual leave balance.'
      );
    }

    const proposed = leaveDurationDays(this.startDate, this.endDate);
    const accrued = await this.getAccruedEntitlement();
    const used = await this.getUsedAnnualLeaveDays();
    const remaining = accrued - used;

    if (proposed > remaining) {
      const ref = this.employee ?? this.name ?? 'this employee';
      throw new Error(
        `Insufficient annual leave balance: this request is for ${proposed} day(s), ` +
          `but ${ref} only has ${remaining} day(s) remaining ` +
          `(accrued ${accrued} day(s) - already used ${used} day(s)).`
      );
    }
  }

  static getListViewSettings(): ListViewSettings {
    return {
      columns: ['name', 'employee', 'type', 'startDate', 'endDate', 'status'],
    };
  }
}
