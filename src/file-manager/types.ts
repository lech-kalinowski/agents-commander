export interface FileEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modified: Date;
  permissions: string;
  extension: string;
}

export type SortField = 'name' | 'size' | 'date' | 'ext';

export interface SortOptions {
  field: SortField;
  ascending: boolean;
  directoriesFirst: boolean;
}
