export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n");
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}