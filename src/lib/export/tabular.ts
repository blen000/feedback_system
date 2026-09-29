import writeExcelFile from "write-excel-file/node";

export type Cell = string | number | boolean | Date | null | undefined;
export interface Table {
  name: string;
  columns: string[];
  rows: Cell[][];
}

/**
 * Spreadsheet formula injection: text starting with = + - @ (or tab/CR) is executed by Excel and
 * LibreOffice when a CSV is opened. Customer free text ends up in exports, so neutralize it.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  const raw = v instanceof Date ? v.toISOString() : typeof v === "string" ? neutralizeFormula(v) : String(v);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel shows Amharic and other scripts correctly. */
export function toCsv(t: Table): string {
  const lines = [t.columns.map(csvCell).join(","), ...t.rows.map((r) => r.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** .xlsx buffer. Strings are typed cells (never formulas), so no escaping is required. */
export async function toXlsx(t: Table): Promise<Buffer> {
  const header = t.columns.map((c) => ({ value: c, fontWeight: "bold" as const }));
  const body = t.rows.map((row) =>
    row.map((v) => {
      if (v === null || v === undefined || v === "") return null;
      if (v instanceof Date) return { value: v, type: Date, format: "yyyy-mm-dd hh:mm" };
      if (typeof v === "number") return { value: v, type: Number };
      if (typeof v === "boolean") return { value: v, type: Boolean };
      return { value: v, type: String };
    }),
  );
  const data = await writeExcelFile(
    [header, ...body] as never,
    { sheet: t.name.slice(0, 31) } as never,
  ).toBuffer();
  return Buffer.from(data);
}
