import type { ExprFn } from "./expr.js";

/**
 * Binds a result column name to an expression function.
 *
 * Corresponds to a statement like `net = cost * quantity` in the spec.
 * The name becomes a new column in the table after evaluation.
 * @internal
 */
export type Definition = {
  readonly name: string;
  readonly fn: ExprFn;
};

/**
 * Creates a Definition that assigns the result of `fn(row)` to a new column named `name`.
 *
 * @example
 * ``` javascript
 * def("net",    (row: Row) => row.cost * row.quantity)  // number column
 * def("vat",    () => 1.2)                              // number constant
 * def("label",  (row: Row) => String(row.cost))         // string column
 * def("active", (row: Row) => row.quantity > 2)         // boolean column
 * ```
 * 
 * @internal
 */
export function def(name: string, fn: ExprFn): Definition {
  return { name, fn };
}
