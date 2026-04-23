import type { ExprFn } from "./expr.js";

/**
 * Binds a result column name to an expression function.
 *
 * Corresponds to a statement like `net = cost * quantity` in the spec.
 * The name becomes a new column in the table after evaluation.
 */
export type Definition = {
  readonly name: string;
  readonly fn: ExprFn;
};

/**
 * Creates a Definition that assigns the result of `fn(row)` to a new column named `name`.
 *
 * @example
 * def("net", (row: Row) => row["cost"]! * row["quantity"]!)  // net = cost * quantity
 * def("vat", () => 1.2)                                      // vat = 1.2 (constant)
 */
export function def(name: string, fn: ExprFn): Definition {
  return { name, fn };
}
