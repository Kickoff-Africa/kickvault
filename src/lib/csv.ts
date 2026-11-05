/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), CRLF/LF, newlines inside quotes.
 * Returns rows of cells; blank lines are skipped.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  const text = input.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      // swallow; the following \n (if any) ends the row
      if (text[i + 1] !== '\n') pushRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

export interface CsvTable {
  headers: string[];
  records: { line: number; values: Record<string, string> }[];
}

/** Parse CSV into records keyed by lower-cased header. Line numbers are 1-based and count the header. */
export function parseCsvTable(input: string): CsvTable {
  const rows = parseCsv(input);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const keys = headers.map((h) => h.toLowerCase());
  const records = rows.slice(1).map((cells, idx) => {
    const values: Record<string, string> = {};
    keys.forEach((k, i) => {
      values[k] = (cells[i] ?? '').trim();
    });
    return { line: idx + 2, values };
  });
  return { headers, records };
}

export function csvEscape(value: string): string {
  // Neutralise spreadsheet formula injection in exported cells.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
