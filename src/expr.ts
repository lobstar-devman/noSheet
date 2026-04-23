/**
 * A snapshot of all columns available when an expression is evaluated.
 * Keys are column names; values are the numeric column values for the current row.
 *
 * `Row` is continuously updated as definitions are applied: it starts with the input
 * table's columns and gains a new entry for each definition that has been evaluated
 * before the current one. Later expression functions therefore have access to all
 * columns produced by earlier definitions.
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
