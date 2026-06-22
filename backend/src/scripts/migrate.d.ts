/**
 * T-FOLLOW-5: Type declarations for migrate.js
 * Allows TS test files to import from './migrate' with proper types.
 */

export interface MigrationFile {
  filename: string;
  filepath: string;
}

export interface MigrationStatus {
  total: number;
  applied: number;
  pending: number;
  missing: string[];
  hasPending: boolean;
  ok: boolean;
  error?: string;
}

export function listMigrations(): MigrationFile[];
export function printStatus(): Promise<void>;
export function checkMigrationsStatus(): Promise<MigrationStatus>;
export function runMigrations(): Promise<void>;
export const MIGRATIONS_DIR: string;