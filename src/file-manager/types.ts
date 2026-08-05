export interface FileEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modified: Date;
  permissions: string;
  extension: string;
  /** Identity of the directory entry itself (lstat), used for safe destructive actions. */
  deviceId?: string;
  inode?: string;
  identityMode?: number;
  /** Exact status-change generation captured from bigint lstat. */
  ctimeNs?: string;
}

export type SortField = 'name' | 'size' | 'date' | 'ext';

export interface SortOptions {
  field: SortField;
  ascending: boolean;
  directoriesFirst: boolean;
}
