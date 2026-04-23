import { def } from "./definition.js";
import { applyDefinitions } from "./table.js";

/**
 * Converts a table type (column arrays) to a row type (scalar values).
 * Used to seed the initial `Cols` type parameter from the input table.
 *
 * @example
 * TableToRow<{ cost: number[]; quantity: number[] }>
 * // => { cost: number; quantity: number }
 */
export type TableToRow<T extends Record<string, number[]>> = { [K in keyof T]: number };

/**
 * Converts an accumulated row type back to a table type (column arrays).
 * This is the return type of `Engine.evaluate()`.
 *
 * @example
 * RowToTable<{ cost: number; quantity: number; net: number }>
 * // => { readonly cost: readonly number[]; ... readonly net: readonly number[] }
 */
export type RowToTable<Cols extends Record<string, number>> = {
  readonly [K in keyof Cols]: readonly number[];
};

/**
 * A typed computation engine that applies sequential expression definitions to tabular data.
 *
 * Each call to `.def()` adds a new column and narrows the `Row` type available to subsequent
 * expressions. This provides IDE autocomplete and compile-time enforcement that expressions
 * only reference columns that have already been defined.
 *
 * @typeParam Cols - The accumulated row type: all columns available at this point in the chain.
 *
 * @example
 * const result = Engine
 *   .from({ cost: [3, 7, 8], quantity: [2, 3, 4] })
 *   .def("net",   (row) => row.cost * row.quantity)
 *   .def("vat",   () => 1.2)
 *   .def("total", (row) => row.net * row.vat)
 *   .evaluate();
 *
 * // result.net   => [6, 21, 32]
 * // result.vat   => [1.2, 1.2, 1.2]
 * // result.total => [7.2, 25.2, 38.4]
 */
export class Engine<Cols extends Record<string, number>> {
  readonly #table: Record<string, number[]>;
  readonly #definitions: ReturnType<typeof def>[];

  private constructor(table: Record<string, number[]>, definitions: ReturnType<typeof def>[]) {
    this.#table = table;
    this.#definitions = definitions;
  }

  /**
   * Creates an Engine seeded with the given table.
   * Column names and types are inferred from the input and become the initial `Row` type.
   */
  static from<T extends Record<string, number[]>>(table: T): Engine<TableToRow<T>> {
    const copy: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(table)) {
      copy[k] = [...v];
    }
    return new Engine<TableToRow<T>>(copy, []);
  }

  /**
   * Adds a named expression to the engine.
   *
   * The expression function receives a `Row` typed to all columns available so far.
   * The return type extends `Cols` with `{ [Name]: number }`, making the new column
   * available to all subsequent `.def()` calls.
   *
   * @param name - The result column name. Must not already exist in the table.
   * @param fn   - Arrow function that computes the column value for each row.
   */
  def<Name extends string>(
    name: Name,
    fn: (row: Cols) => number,
  ): Engine<Cols & Record<Name, number>> {
    return new Engine<Cols & Record<Name, number>>(this.#table, [
      ...this.#definitions,
      // Cast is safe: Cols is structurally Record<string, number> at runtime.
      // The generic parameter is erased; the runtime row object is always Record<string, number>.
      def(name, fn as (row: Record<string, number>) => number),
    ]);
  }

  /**
   * Evaluates all definitions in declaration order and returns the extended table.
   * The return type is fully typed to all columns in `Cols`.
   */
  evaluate(): RowToTable<Cols> {
    return applyDefinitions(this.#table, this.#definitions) as RowToTable<Cols>;
  }
}
