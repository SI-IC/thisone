export function baseName(file: string): string {
  const noQuery = file.split(/[?#]/)[0];
  const last = noQuery.split(/[\\/]/).pop() || noQuery;
  return last.replace(/\.\w+$/, "");
}
