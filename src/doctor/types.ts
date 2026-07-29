export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorRow {
  id: string;
  label: string;
  status: DoctorStatus;
  summary: string;
  detail?: string;
}

export interface DoctorReport {
  rows: DoctorRow[];
  passed: number;
  warnings: number;
  failures: number;
}
