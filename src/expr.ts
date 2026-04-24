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
 */
export type Row = Record<string, CellValue>;

/**
 * An expression function. Receives a row snapshot and returns a CellValue.
 *
 * @example
 * (row: Row) => row.cost * row.quantity          // number
 * () => 1.2                                      // number constant
 * (row: Row) => row.quantity > 2                 // boolean
 * (row: Row) => String(row.cost)                 // string
 */
export type ExprFn = (row: Row) => CellValue;
