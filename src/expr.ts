/**
 * The set of value types a column can hold.
 */
export type CellValue = number | string | bigint | boolean;

/**
 * A snapshot of all columns available when an expression is evaluated.
 * Keys are column names; values are the cell value for the current row.
 *
 * `Row` is continuously updated as definitions are applied: it starts with the input
 * table's columns and gains a new entry for each definition that has been evaluated
 * before the current one. Later expression functions therefore have access to all
 * columns produced by earlier definitions.
 * 
 * @beta
 */
export type Row = Record<string, CellValue>;

/**
 * An expression function. Receives a row snapshot and the current aggregate results,
 * and returns a CellValue.
 *
 * @example
 * ```javascript
 * (row, aggs) => row.cost * row.quantity         // number, no aggs used
 * (row, aggs) => row.x / aggs.total              // references a scalar aggregate
 * (row, aggs) => aggs.rank[aggs.rank.indexOf(row.x)]  // references a per-row aggregate
 * ```
 * 
 * @beta
 */
export type ExprFn = (row: Row, aggs: Record<string, CellValue | CellValue[]>) => CellValue;

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
