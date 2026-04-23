/**
 * A snapshot of all columns available when an expression is evaluated.
 * Keys are column names; values are the numeric column values for the current row.
 *
 * `Row` contains all input columns plus any columns produced by earlier definitions.
 * `applyDefinitions()` guarantees every key in the row is present and numeric —
 * access columns as plain properties: `row.cost`, `row.net`, etc.
 */
export type Row = Record<string, number>;

/**
 * An expression function. Receives a row snapshot and returns a number.
 *
 * @example
 * (row: Row) => row.cost * row.quantity   // net = cost * quantity
 * () => 1.2                               // vat = 1.2 (constant)
 */
export type ExprFn = (row: Row) => number;
