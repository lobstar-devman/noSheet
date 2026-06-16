/**
 * The set of value types a column can hold.
 *
 * The `object` branch accommodates opaque values returned by external libraries
 * such as mathjs or decimal.js.
 *
 * @beta
 */
export type CellValue = number | string | bigint | boolean | object;

/**
 * Provides relative and filter-based access to sibling rows from within a `.def()` expression.
 *
 * - `get(offset)` — returns the row at `currentIndex + offset`, or `undefined` if out of bounds.
 *   Rows *before* the current one will include the current step's computed value (already evaluated);
 *   rows *at or after* the current one will not (not yet evaluated in this step).
 * - `get(filter)` — scans all rows and returns the first one for which `filter` returns `true`,
 *   or `undefined` if none match. The same partial-column rule applies per row.
 *
 * The returned snapshot is a plain object containing only columns available at the point
 * where `.get` is called in the pipeline — it does not itself have a `.get` method.
 *
 * @beta
 */
export type RowGet = {
  (offset: number): Record<string, CellValue> | undefined;
  (filter: (row: Record<string, CellValue>) => boolean): Record<string, CellValue> | undefined;
};

/**
 * A snapshot of all columns available when an expression is evaluated.
 * Keys are column names; values are the cell value for the current row.
 *
 * `Row` is continuously updated as definitions are applied: it starts with the input
 * table's columns and gains a new entry for each definition that has been evaluated
 * before the current one. Later expression functions therefore have access to all
 * columns produced by earlier definitions.
 *
 * The `.get` method provides access to sibling rows — see {@link RowGet}.
 *
 * @beta
 */
export type Row = Record<string, CellValue> & { get: RowGet };

/**
 * Intrinsic, per-step values about the current row and column that aren't derivable
 * from `row` or `aggs` alone. Passed as the third argument to an {@link ExprFn} so they
 * can never collide with — or be masked by — a data column of the same name.
 *
 * - `rowIndex` / `rowCount` — the current row's 0-based position, and the total number
 *   of rows in the table. `rowIndex` advances as each row in the current step is evaluated.
 * - `defOffset` — 0-based position of the current `.def()` step among `.def()` steps only
 *   (`.agg()` / `.aggRow()` steps don't advance it).
 * - `colIndex` — 0-based position the current step's column will occupy in the full header
 *   row, counting input columns and all earlier `.def()` columns.
 *
 * @beta
 */
export type RowMeta = {
  rowIndex: number;
  rowCount: number;
  defOffset: number;
  colIndex: number;
};

/**
 * An expression function. Receives a row snapshot, the current aggregate results, and
 * intrinsic row/column metadata, and returns a CellValue.
 *
 * @example
 * ```javascript
 * (row, aggs) => row.cost * row.quantity              // number, no aggs used
 * (row, aggs) => row.x / aggs.total                   // references a scalar aggregate
 * (row, aggs) => row.get(-1)?.x ?? 0                  // previous row's x value
 * (row, aggs) => row.get(r => r.id === row.id)        // filter-based sibling lookup
 * (row, aggs, meta) => `item ${meta.rowIndex} of ${meta.rowCount}`
 * ```
 *
 * @beta
 */
export type ExprFn = (
  row: Row,
  aggs: Record<string, CellValue | CellValue[]>,
  meta: RowMeta,
) => CellValue;

/**
 * A scalar aggregate function. Receives all input columns as arrays and previously
 * computed aggregates, and returns a single CellValue.
 *
 * @example
 * ```javascript
 * (cols, aggs) => cols.x.reduce((a, b) => (a as number) + (b as number), 0)
 * (cols, aggs) => (aggs.total as number) / cols.x.length
 * ```
 *
 * @beta
 */
export type AggFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue | CellValue[]>,
) => CellValue;

/**
 * A per-row aggregate function. Receives all input columns as arrays and previously
 * computed aggregates, and returns a CellValue array with one value per row.
 *
 * @example
 * ```javascript
 * (cols, aggs) => cols.x.map((v, i) => (v as number) / (aggs.total as number))
 * ```
 *
 * @beta
 */
export type AggRowFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue | CellValue[]>,
) => CellValue[];
