import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvTable, csvEscape } from './csv.js';

describe('parseCsv', () => {
  it('parses plain rows and skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles quoted fields, escaped quotes and embedded commas/newlines', () => {
    const rows = parseCsv('name,secret\n"Smith, J","pa""ss"\n"multi\nline",x');
    expect(rows[1]).toEqual(['Smith, J', 'pa"ss']);
    expect(rows[2]).toEqual(['multi\nline', 'x']);
  });

  it('handles CRLF and a UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps PEM-style secrets intact', () => {
    const rows = parseCsv('friendlyName,secret\nProd SSH Key,-----BEGIN RSA PRIVATE KEY-----');
    expect(rows[1][1]).toBe('-----BEGIN RSA PRIVATE KEY-----');
  });
});

describe('parseCsvTable', () => {
  it('keys records by lower-cased header and tracks line numbers', () => {
    const t = parseCsvTable('assetId,Name\nHW-1,Laptop\nHW-2,Phone');
    expect(t.records[0]).toEqual({ line: 2, values: { assetid: 'HW-1', name: 'Laptop' } });
    expect(t.records[1].line).toBe(3);
  });

  it('pads short rows with empty strings', () => {
    const t = parseCsvTable('a,b,c\n1');
    expect(t.records[0].values).toEqual({ a: '1', b: '', c: '' });
  });
});

describe('csvEscape', () => {
  it('quotes values containing commas, quotes or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('neutralises spreadsheet formula injection', () => {
    expect(csvEscape('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvEscape('@cmd')).toBe("'@cmd");
  });
});
