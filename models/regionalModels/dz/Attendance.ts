import { Doc } from 'fyo/model/doc';
import { ListViewSettings } from 'fyo/model/types';

export class Attendance extends Doc {
  employee?: string;
  date?: Date;
  status?: string;
  hoursWorked?: number;
  remark?: string;

  static getListViewSettings(): ListViewSettings {
    return {
      columns: ['name', 'employee', 'date', 'status', 'hoursWorked'],
    };
  }
}
