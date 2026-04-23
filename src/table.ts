import type { Definition } from "./definition.js";

/**
 * A table is a set of named columns, each holding one numeric value per row.
 * All columns must have the same length.
 */
export type Table = Readonly<Record<string, readonly number[]>>;

/**
 * Applies an ordered list of definitions to a table, row by row, in declaration order.
 *
 * Each definition produces a new column appended to the table. Later definitions
 * can reference columns produced by earlier ones. The original table is not mutated.
 *
 * @throws {Error} if a definition's function references a column that does not exist.
 * @throws {Error} if the table has columns of unequal length.
 * @throws {Error} if a definition name collides with an existing column.
 */
export function applyDefinitions(table: Table, definitions: readonly Definition[]): Table {
  const rowCount = resolveRowCount(table);
  const columns: Record<string, readonly number[]> = { ...table };

  for (const { name, fn } of definitions) {
    if (Object.prototype.hasOwnProperty.call(columns, name)) {
      throw new Error(`Column "${name}" already exists in the table.`);
    }

    const column: number[] = [];

    for (let i = 0; i < rowCount; i++) {
      // Build a flat row view from all columns available so far (input + previously computed).
      const row: Record<string, number> = {};
      for (const [colName, values] of Object.entries(columns)) {
        row[colName] = values[i];
      }
      column.push(fn(row));
    }

    columns[name] = column;
  }

  return columns;
}

function resolveRowCount(table: Table): number {
  const lengths = Object.values(table).map((col) => col.length);
  if (lengths.length === 0) return 0;

  const first = lengths[0] ?? 0;
  for (const len of lengths) {
    if (len !== first) {
      throw new Error(
        `Table columns have unequal lengths: expected ${String(first)}, found ${String(len)}.`,
      );
    }
  }
  return first;
}
