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
 * @beta
 */
export type RowGet = {
  (offset: number): Record<string, CellValue> | undefined;
  (filter: (row: Record<string, CellValue>) => boolean): Record<string, CellValue> | undefined;
};

/**
 * A snapshot of all columns available when a `.def()` expression is evaluated.
 * Keys are column names; values are the cell value for the current row.
 * Pure data — no methods. Use `meta.get()` and `meta.upstream()` for row navigation.
 *
 * @beta
 */
export type Row = Record<string, CellValue>;

/**
 * Column arrays from all upstream (prior) rows, keyed by column name.
 * Returned by `meta.upstream()`.
 *
 * @beta
 */
export type UpstreamRows = Record<string, CellValue[]>;

/**
 * Donor aggregate arrays from upstream tables, keyed by aggregate name.
 * Returned by `aggMeta.upstream()`.
 *
 * @beta
 */
export type UpstreamAggs = Record<string, CellValue[]>;

/**
 * Provides offset and filter-based access to donor aggregate objects across tables.
 * Passed as `aggMeta.get` inside an `.agg()` expression.
 *
 * @beta
 */
export type AggMetaGet = (
  indexOrFilter:
    | number
    | ((aggs: Record<string, CellValue | CellValue[]>) => boolean),
) => Record<string, CellValue | CellValue[]> | undefined;

/**
 * Intrinsic, per-step values about the current row and column. Passed as the third
 * argument to a `.def()` expression so they can never collide with — or be masked by —
 * a data column of the same name.
 *
 * - `rowIndex` / `rowCount` — the current row's 0-based position and total row count.
 * - `defOffset` — 0-based position of the current `.def()` step among `.def()` steps only.
 * - `colIndex` — 0-based position the current step's column will occupy in the header row.
 * - `tableIndex` / `tableCount` — 0-based table position when running in multi-table mode
 *   (always 0 / 1 for single-table engines).
 * - `get(offset|filter)` — relative or filter-based access to sibling rows.
 * - `upstream(filter?)` — column arrays from all prior rows (optionally filtered).
 *
 * @beta
 */
export type RowMeta = {
  rowIndex: number;
  rowCount: number;
  defOffset: number;
  colIndex: number;
  tableIndex: number;
  tableCount: number;
  get: RowGet;
  upstream: (filter?: (row: Record<string, CellValue>) => boolean) => UpstreamRows;
};

/**
 * Intrinsic metadata for an `.agg()` expression — analogous to {@link RowMeta} but
 * for donor aggregate objects rather than rows.
 *
 * - `tableIndex` / `tableCount` — position of the current table in the multi-table set.
 * - `get(offset|filter)` — navigates donor aggregate objects by table processing order.
 * - `upstream(filter?)` — yields prior tables' donor aggregate objects as key-keyed arrays.
 *
 * @beta
 */
export type AggMeta = {
  tableIndex: number;
  tableCount: number;
  get: AggMetaGet;
  upstream: (
    filter?: (aggs: Record<string, CellValue | CellValue[]>) => boolean,
  ) => UpstreamAggs;
};

/**
 * An expression function. Receives a pure row snapshot, the current aggregate results, and
 * intrinsic row/column metadata, and returns a CellValue.
 *
 * @beta
 */
export type ExprFn = (
  row: Row,
  aggs: Record<string, CellValue | CellValue[]>,
  meta: RowMeta,
) => CellValue;

/**
 * A scalar aggregate function. Receives all input columns as arrays, previously computed
 * aggregates, and aggregate-level intrinsic metadata, and returns a single CellValue.
 *
 * @beta
 */
export type AggFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue | CellValue[]>,
  aggMeta: AggMeta,
) => CellValue;

/**
 * A cardinal (cross-table) function. Runs once across all tables after all per-table
 * steps for the current position have completed. Returns a single scalar CellValue.
 *
 * - `cols` — raw column arrays concatenated across all tables.
 * - `aggs` — per-key arrays of donor aggregate values (one per table).
 * - `cards` — cardinals accumulated so far in declaration order.
 *
 * @beta
 */
export type CardinalFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue[]>,
  cards: Record<string, CellValue>,
) => CellValue;
