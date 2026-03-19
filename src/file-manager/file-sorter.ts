import type { FileEntry, SortOptions } from './types.js';

export function sortFiles(files: FileEntry[], options: SortOptions): FileEntry[] {
  const sorted = [...files];

  sorted.sort((a, b) => {
    // Directories always first if enabled
    if (options.directoriesFirst) {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
    }

    let cmp = 0;
    switch (options.field) {
      case 'name':
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case 'ext':
        cmp = a.extension.localeCompare(b.extension) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'date':
        cmp = a.modified.getTime() - b.modified.getTime();
        break;
    }

    return options.ascending ? cmp : -cmp;
  });

  return sorted;
}
