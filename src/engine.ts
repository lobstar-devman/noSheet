import type { CellValue } from "./expr.js";
import { def } from "./definition.js";
import { applyDefinitions } from "./table.js";

/**
 * Converts a table type (column arrays) to a row type (scalar values).
 *
 * @example
 * TableToRow<{ cost: number[]; label: string[]; active: boolean[] }>
 * // => { cost: number; label: string; active: boolean }
 */
export type TableToRow<T extends Record<string, CellValue[]>> = {
  [K in keyof T]: T[K] extends readonly (infer V extends CellValue)[]
    ? V
    : T[K] extends (infer V extends CellValue)[]
      ? V
      : CellValue;
};

/**
 * Converts an accumulated row type back to a table type (column arrays).
 * This is the return type of `Engine.evaluate()`.
 *
 * @example
 * RowToTable<{ cost: number; label: string; active: boolean }>
 * // => { readonly cost: readonly number[]; readonly label: readonly string[]; readonly active: readonly boolean[] }
 */
export type RowToTable<Cols extends Record<string, CellValue>> = {
  readonly [K in keyof Cols]: readonly Cols[K][];
};

/**
 * A typed computation engine that applies sequential expression definitions to tabular data.
 *
 * The input schema is declared as a type parameter on construction. Expression functions
 * receive a `Row` typed to the input columns plus any columns produced by earlier definitions,
 * enabling IDE autocomplete and compile-time enforcement that expressions only reference
 * columns that have already been defined.
 *
 * Data is supplied at evaluation time via `evaluate(table)`, so the same engine instance
 * can be reused with different datasets.
 *
 * @typeParam Input - The input table type. Determines which column names and value types
 *                   are available in expression functions from the start of the chain.
 * @typeParam Cols  - The accumulated row type. Starts as TableToRow<Input> and grows
 *                   with each `.def()` call.
 *
 * @example
 * const engine = new Engine<{ cost: number[]; quantity: number[] }>()
 *   .def("net",    (row) => row.cost * row.quantity)
 *   .def("vat",    () => 1.2)
 *   .def("total",  (row) => row.net * row.vat)
 *   .def("label",  (row) => String(row.net))
 *   .def("active", (row) => row.quantity > 2);
 *
 * const result = engine.evaluate({ cost: [3, 7, 8], quantity: [2, 3, 4] });
 * // result.net    => [6, 21, 32]          (number[])
 * // result.label  => ["6", "21", "32"]    (string[])
 * // result.active => [false, true, true]  (boolean[])
 */
export class Engine<
  Input extends Record<string, CellValue[]>,
  Cols extends Record<string, CellValue> = TableToRow<Input>,
> {
  readonly #definitions: ReturnType<typeof def>[];

  constructor(definitions: ReturnType<typeof def>[] = []) {
    this.#definitions = definitions;
  }

  /**
   * Adds a named expression to the engine.
   *
   * The expression function receives a `Row` typed to all columns available so far
   * (input columns + previously defined columns). The return type `V` is inferred from
   * the function and added to `Cols`, making the new column available to subsequent calls.
   *
   * @param name - The result column name. Must not already exist in the input table.
   * @param fn   - Arrow function that computes the column value for each row.
   */
  def<Name extends string, V extends CellValue>(
    name: Name,
    fn: (row: Cols) => V,
  ): Engine<Input, Cols & Record<Name, V>> {
    return new Engine<Input, Cols & Record<Name, V>>([
      ...this.#definitions,
      // Double cast via unknown: function parameter contravariance prevents a direct cast
      // from (row: Cols) => V to (row: Record<string, CellValue>) => CellValue.
      // Safe because Cols is structurally Record<string, CellValue> at runtime.
      def(name, fn as unknown as (row: Record<string, CellValue>) => CellValue),
    ]);
  }

  /**
   * Evaluates all definitions against the supplied table, row by row, in declaration order.
   *
   * The table must conform to the `Input` type declared on the engine. The return type
   * is fully typed to all columns in `Cols`, preserving per-column value types.
   *
   * @param table - The input data. Each column must be an array of equal length.
   * @throws {Error} if a definition name collides with an existing column.
   * @throws {Error} if the table has columns of unequal length.
   */
  evaluate(table: Input): RowToTable<Cols> {
    // Defensive copy so the engine does not mutate the caller's data.
    const copy: Record<string, CellValue[]> = {};
    for (const [k, v] of Object.entries(table)) {
      copy[k] = [...v];
    }
    return applyDefinitions(copy, this.#definitions) as RowToTable<Cols>;
  }
}
