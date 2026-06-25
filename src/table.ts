import type { CellValue, Row, RowGet, RowMeta, UpstreamRows } from "./expr.js";
import type { Definition } from "./definition.js";

/**
 * A table is a set of named columns, each holding one cell value per row.
 * All columns must have the same length.
 * Column values may be number, string, bigint, or boolean.
 *
 * @beta
 */
export type Table = Readonly<Record<string, readonly CellValue[]>>;

/**
 * Applies an ordered list of definitions to a table, row by row, in declaration order.
 *
 * Each definition produces a new column appended to the table. Later definitions
 * can reference columns produced by earlier ones. The original table is not mutated.
 *
 * @throws `{Error}` if a definition name collides with an existing column.
 * @throws `{Error}` if the table has columns of unequal length.
 *
 * @beta
 */
export function applyDefinitions(table: Table, definitions: readonly Definition[]): Table {
  const rowCount = resolveRowCount(table);
  const columns: Record<string, readonly CellValue[]> = { ...table };

  let defOffset = 0;
  for (const { name, fn } of definitions) {
    if (Object.prototype.hasOwnProperty.call(columns, name)) {
      throw new Error(`Column "${name}" already exists in the table.`);
    }

    const column: CellValue[] = [];

    const buildAt = (idx: number): Record<string, CellValue> => {
      const r: Record<string, CellValue> = {};
      for (const [c, vals] of Object.entries(columns)) r[c] = vals[idx];
      return r;
    };

    for (let i = 0; i < rowCount; i++) {
      const row: Row = {};
      for (const [colName, values] of Object.entries(columns)) {
        row[colName] = values[i];
      }

      const get: RowGet = (
        offsetOrFilter: number | ((r: Record<string, CellValue>) => boolean),
      ): Record<string, CellValue> | undefined => {
        if (typeof offsetOrFilter === "function") {
          for (let j = 0; j < rowCount; j++) {
            const r = buildAt(j);
            if (offsetOrFilter(r)) return r;
          }
          return undefined;
        }
        const target = i + offsetOrFilter;
        if (target < 0 || target >= rowCount) return undefined;
        return buildAt(target);
      };

      const upstream = (
        filter?: (r: Record<string, CellValue>) => boolean,
      ): UpstreamRows => {
        const result: UpstreamRows = {};
        for (let j = 0; j < i; j++) {
          const r = buildAt(j);
          if (!filter || filter(r)) {
            for (const [k, v] of Object.entries(r)) {
              if (!(k in result)) result[k] = [];
              result[k].push(v);
            }
          }
        }
        return result;
      };

      const meta: RowMeta = {
        rowIndex: i,
        rowCount,
        defOffset,
        colIndex: Object.keys(columns).length,
        tableIndex: 0,
        tableCount: 1,
        get,
        upstream,
      };

      column.push(fn(row, {}, meta));
    }

    columns[name] = column;
    defOffset++;
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
