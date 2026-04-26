import type { CellValue } from "./expr.js";
import { def } from "./definition.js";

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
 * A typed computation engine that applies sequential expression definitions to tabular data.
 *
 * The input schema is declared as a type parameter on construction. Expression functions
 * receive a `Row` typed to the input columns plus any columns produced by earlier definitions,
 * enabling IDE autocomplete and compile-time enforcement that expressions only reference
 * columns that have already been defined.
 *
 * Data is supplied as a mutable 2D row-oriented array at evaluation time. `evaluate()`
 * appends computed values to each row in-place and returns void.
 *
 * @typeParam Input - The input table type. Determines which column names and value types
 *                   are available in expression functions from the start of the chain.
 * @typeParam Cols  - The accumulated row type. Starts as TableToRow<Input> and grows
 *                   with each `.def()` call.
 *
 * @example
 * const engine = new Engine<{ cost: number[]; quantity: number[] }>()
 *   .def("net",   (row) => row.cost * row.quantity)
 *   .def("vat",   () => 1.2)
 *   .def("total", (row) => row.net * row.vat);
 *
 * const headers = ["cost", "quantity"];
 * const rows: CellValue[][] = [[3, 2], [7, 3], [8, 4]];
 * engine.evaluate(headers, rows);
 * // headers => ["cost", "quantity", "net", "vat", "total"]
 * // rows    => [[3,2,6,1.2,7.2], [7,3,21,1.2,25.2], [8,4,32,1.2,38.4]]
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
   * @param name - The result column name. Must not already exist in the headers.
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
   * Evaluates all definitions against the supplied rows, mutating them in-place.
   *
   * For each definition, the computed value is pushed onto every row and the definition's
   * name is pushed onto `headers`. Definitions are applied in declaration order; later
   * definitions can reference columns added by earlier ones.
   *
   * @param headers - Mutable array of column names, one per position in each row.
   *                  Definition names are appended here as new columns are computed.
   * @param rows    - Mutable 2D array of row data. Each inner array must have the same
   *                  length as `headers` on entry. Computed values are pushed onto each row.
   * @throws {Error} if a definition name already exists in `headers`.
   * @throws {Error} if any row length does not match `headers` length on entry.
   */
  evaluate(headers: string[], rows: CellValue[][]): void {
    for (const row of rows) {
      if (row.length !== headers.length) {
        throw new Error(
          `Row length ${String(row.length)} does not match headers length ${String(headers.length)}.`,
        );
      }
    }

    for (const { name, fn } of this.#definitions) {
      if (headers.includes(name)) {
        throw new Error(`Column "${name}" already exists in headers.`);
      }

      for (const row of rows) {
        // Build a row snapshot from the current headers and row values.
        const snapshot: Record<string, CellValue> = {};
        for (let i = 0; i < headers.length; i++) {
          // headers and row are guaranteed equal length by the pre-check above.
          snapshot[headers[i]] = row[i];
        }
        row.push(fn(snapshot));
      }

      headers.push(name);
    }
  }
}
