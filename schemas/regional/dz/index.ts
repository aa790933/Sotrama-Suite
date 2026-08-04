import { SchemaStub } from '../../types';
import Attendance from './Attendance.json';
import Department from './Department.json';
import Designation from './Designation.json';
import EarningItem from './EarningItem.json';
import Employee from './Employee.json';
import LeaveApplication from './LeaveApplication.json';
import PayrollSettings from './PayrollSettings.json';
import SalarySlip from './SalarySlip.json';

/**
 * Regional (Algeria - "dz") schemas.
 *
 * These are merged on top of the core/app schema map by `getAppSchemas`
 * (see schemas/index.ts), so they are only loaded for Algerian instances.
 */
export default [
  Department,
  Designation,
  Employee,
  EarningItem,
  Attendance,
  LeaveApplication,
  PayrollSettings,
  SalarySlip,
] as SchemaStub[];
