export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '       0';
  const units = ['B', 'K', 'M', 'G', 'T'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  const str = i === 0 ? bytes.toString() : size.toFixed(1);
  return `${str}${units[i]}`.padStart(8);
}

export function formatDate(date: Date): string {
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const y = date.getFullYear().toString().slice(2);
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${m}/${d}/${y} ${h}:${min}`;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '~';
}
