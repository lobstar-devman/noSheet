import type { Expr } from "./expr.js";

/**
 * Binds a result column name to an expression.
 *
 * Corresponds to a statement like `net = cost * quantity` in the spec.
 * The name becomes a new column in the table after evaluation.
 */
export type Definition = {
  readonly name: string;
  readonly expr: Expr;
};

/**
 * Creates a Definition that assigns the result of `expr` to a new column named `name`.
 *
 * @example
 * def("net", mul(col("cost"), col("quantity")))  // net = cost * quantity
 * def("vat", scalar(1.2))                        // vat = 1.2
 */
export function def(name: string, expr: Expr): Definition {
  return { name, expr };
}
