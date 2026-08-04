import { Doc } from 'fyo/model/doc';
import { ListViewSettings } from 'fyo/model/types';

export class LeaveApplication extends Doc {
  employee?: string;
  startDate?: Date;
  endDate?: Date;
  type?: string;
  status?: string;
  remark?: string;

  static getListViewSettings(): ListViewSettings {
    return {
      columns: ['name', 'employee', 'type', 'startDate', 'endDate', 'status'],
    };
  }
}
