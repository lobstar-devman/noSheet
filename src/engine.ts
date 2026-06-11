import type { CellValue, AggFn, AggRowFn } from "./expr.js";
export type { CellValue, AggFn, AggRowFn };

/**
 * Compiles an expression string into a reusable scope evaluator.
 * The outer call happens once per expression (pre-compilation);
 * the returned function is invoked once per row or column evaluation.
 *
 * @example
 * ```javascript
 * const compiler: ExprCompiler = (expr) => {
 *   const compiled = math.compile(expr);
 *   return (scope) => compiled.evaluate(scope);
 * };
 * new Engine(compiler).def("cost", "price * qty");
 * ```
 * @beta
 */
export type ExprCompiler<V extends CellValue = CellValue> = (expression: string) => (scope: Record<string, unknown>) => V | V[];
/**
 * Converts a table type (column arrays) to a row type (scalar values).
 *
 * @example
 * ``` javascript
 * TableToRow<{ cost: number[]; label: string[] }>
 * // => { cost: number; label: string }
 * ```
 *
 * @beta
 */
export type TableToRow<T extends Record<string, CellValue[]>> = {
  [K in keyof T]: T[K][number];
};

// ── Internal step discriminated union ─────────────────────────────────────────

/**
 * @beta
 */
export type DefStep = {
  kind: "def";
  name: string;
  fn: (row: Record<string, CellValue>, aggs: Record<string, CellValue | CellValue[]>) => CellValue;
};

/**
 * @beta
 */
export type AggStep = {
  kind: "agg";
  name: string;
  fn: AggFn;
};

/**
 * @beta
 */
export type AggRowStep = {
  kind: "aggRow";
  name: string;
  fn: AggRowFn;
};

/**
 * @beta
 */
export type Step = DefStep | AggStep | AggRowStep;

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * A typed computation engine that applies sequential row expressions and aggregate
 * expressions to tabular data.
 *
 * Three kinds of step can be chained in any order:
 *
 * - `.def(name, (row, aggs) => value)` — row expression. Evaluated once per row.
 *   `row` is typed to all input columns + previously defined row columns.
 *   `aggs` is typed to all previously computed aggregates.
 *   Result is appended to each row and added to `headers`.
 *
 * - `.agg(name, (cols, aggs) => scalar)` — scalar aggregate. Evaluated once across
 *   all rows. `cols` contains the full input column arrays. Result is a single
 *   CellValue stored in `aggs`; it does NOT appear in the output rows.
 *
 * - `.aggRow(name, (cols, aggs) => array)` — per-row aggregate. Evaluated once across
 *   all rows, returning one value per row. Result is stored in `aggs` as a CellValue[];
 *   it does NOT appear in the output rows. Row expressions access it via `aggs.name[i]`.
 *
 * @typeParam Input - The input table type.
 * @typeParam Val   - The value type for all cells. Defaults to {@link CellValue}; pass a
 *                   narrower union (e.g. `CellValue | Decimal`) to allow library-specific
 *                   types to flow through without casting.
 * @typeParam Cols  - Accumulated row type (grows with each `.def()` call).
 * @typeParam Aggs  - Accumulated aggregate type (grows with each `.agg()` / `.aggRow()` call).
 *
 * @example
 * ``` javascript
 * const engine = new Engine<{ x: number[] }>()
 *   .agg("total",  (cols) => cols.x.reduce((a, b) => (a as number) + (b as number), 0))
 *   .aggRow("pct", (cols, aggs) => cols.x.map((v) => (v as number) / (aggs.total as number)))
 *   .def("share",  (row, aggs) => (aggs.pct as number[])[???])  // see evaluate() for rowIndex
 *   .def("doubled", (row) => row.x * 2);
 * ```
 * @beta
 */
export class Engine<
  Input extends Record<string, CellValue[]>,
  Val extends CellValue = CellValue,
  Cols extends { [K in keyof Input]: Input[K][number] } = TableToRow<Input>,
  Aggs extends Record<string, Val | Val[]> = Record<never, never>,
> {
  readonly #steps: Step[];
  readonly #compiler: ExprCompiler<Val> | undefined;

  constructor(compiler?: ExprCompiler<Val>)
  constructor(steps: Step[], compiler?: ExprCompiler<Val>)
  constructor(stepsOrCompiler?: Step[] | ExprCompiler<Val>, compiler?: ExprCompiler<Val>) {
    if (Array.isArray(stepsOrCompiler)) {
      this.#steps = stepsOrCompiler;
      this.#compiler = compiler;
    } else {
      this.#steps = [];
      this.#compiler = stepsOrCompiler;
    }
  }

  /**
   * Adds a row expression. Evaluated once per row during `evaluate()`.
   *
   * @param name - Result column name. Appended to `headers` and each row.
   * @param fn   - Receives the current row (typed to `Cols`) and all computed aggregates
   *               (typed to `Aggs`). Returns the value for this row.
   */
  def<Name extends string, V extends Val>(
    name: Name,
    fn: (row: Cols & { [K in keyof Input]: Input[K][number] }, aggs: Aggs) => V,
  ): Engine<Input, Val, Cols & Record<Name, V>, Aggs>
  def<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): Engine<Input, Val, Cols & Record<Name, Val>, Aggs>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeDefFn(fnOrExpr) : fnOrExpr;
    const step: DefStep = { kind: "def", name, fn: fn as unknown as DefStep["fn"] };
    return new Engine([...this.#steps, step], this.#compiler);
  }

  /**
   * Adds a scalar aggregate. Evaluated once across all rows before any subsequent step.
   *
   * @param name - Aggregate name. Available as `aggs.name` in subsequent `.def()`,
   *               `.agg()`, and `.aggRow()` calls. Not added to `headers` or rows.
   * @param fn   - Receives all column arrays available so far (input columns + columns
   *               produced by earlier `.def()` steps) and previously computed aggregates.
   *               Returns a single CellValue.
   */
  agg<Name extends string, V extends Val>(
    name: Name,
    fn: (cols: Input & { [K in keyof Cols]: Val[] }, aggs: Aggs) => V,
  ): Engine<Input, Val, Cols, Aggs & Record<Name, V>>
  agg<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): Engine<Input, Val, Cols, Aggs & Record<Name, Val>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agg(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeAggFn(fnOrExpr) : fnOrExpr;
    const step: AggStep = { kind: "agg", name, fn: fn as AggFn };
    return new Engine([...this.#steps, step], this.#compiler);
  }

  /**
   * Adds a per-row aggregate. Evaluated once across all rows before any subsequent step.
   *
   * @param name - Aggregate name. Available as `aggs.name` in subsequent `.def()`,
   *               `.agg()`, and `.aggRow()` calls. `aggs.name` is a `V[]` array;
   *               row expressions access the current row's value via `aggs.name[rowIndex]`.
   * @param fn   - Receives all column arrays available so far (input columns + columns
   *               produced by earlier `.def()` steps) and previously computed aggregates.
   *               Returns a `V[]` with one value per row.
   */
  aggRow<Name extends string, V extends Val>(
    name: Name,
    fn: (cols: Input & { [K in keyof Cols]: Val[] }, aggs: Aggs) => V[],
  ): Engine<Input, Val, Cols, Aggs & Record<Name, V[]>>
  aggRow<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): Engine<Input, Val, Cols, Aggs & Record<Name, Val[]>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aggRow(name: string, fnOrExpr: any): any {
    const fn = typeof fnOrExpr === "string" ? this.#makeAggRowFn(fnOrExpr) : fnOrExpr;
    const step: AggRowStep = { kind: "aggRow", name, fn: fn as unknown as AggRowFn };
    return new Engine([...this.#steps, step], this.#compiler);
  }

  #requireCompiler(expression: string): (scope: Record<string, unknown>) => Val | Val[] {
    if (!this.#compiler) {
      throw new Error(
        `Expression "${expression}" requires a compiler. Pass one to the Engine constructor: new Engine(compiler).`,
      );
    }
    return this.#compiler(expression);
  }

  #makeDefFn(expression: string): DefStep["fn"] {
    const evaluate = this.#requireCompiler(expression);
    return (row, aggs) => evaluate({ ...row, ...aggs });
  }

  #makeAggFn(expression: string): AggFn {
    const evaluate = this.#requireCompiler(expression);
    return (cols, aggs) => evaluate({ ...cols, ...aggs });
  }

  #makeAggRowFn(expression: string): AggRowFn {
    const evaluate = this.#requireCompiler(expression);
    return (cols, aggs) => evaluate({ ...cols, ...aggs }) as unknown as CellValue[];
  }

  /**
   * Evaluates all steps against the supplied rows, mutating them in-place.
   *
   * Steps are executed in declaration order. Aggregate steps run once across all rows
   * and store their result in an internal `aggs` map. Row expression steps run once
   * per row, pushing the computed value onto each row and appending the name to `headers`.
   *
   * Row expressions receive `(row, aggs, rowIndex)` at runtime, where `rowIndex` is the
   * 0-based index of the current row — useful for indexing into per-row aggregate arrays.
   *
   * @param headers - Mutable column name array. Row expression names are appended here.
   * @param rows    - Mutable 2D row array. Each inner array must match `headers.length`
   *                  on entry. Row expression values are pushed onto each row.
   * @throws `{Error}` if a def name already exists in `headers`.
   * @throws `{Error}` if any row length does not match `headers` length on entry.
   */
  evaluate(headers: string[], rows: Val[][]): void;
  /**
   * Evaluates all steps against the supplied row objects, mutating them in-place.
   *
   * Each object is expected to contain keys for all input columns. New computed
   * properties are assigned directly onto the original objects.
   *
   * @param headers - Mutable column name array. Row expression names are appended here.
   * @param rows    - Mutable object rows. Each object must contain input column keys.
   * @throws `{Error}` if a def name already exists in `headers`.
   */
  evaluate(headers: string[], rows: Array<Record<string, Val>>): void;
  evaluate(headers: string[], rows: CellValue[][] | Array<Record<string, CellValue>>): void {
    if (Array.isArray(rows) && rows.length > 0 && !Array.isArray(rows[0])) {
      const objectRows = rows as Array<Record<string, CellValue>>;
      const aggs: Record<string, CellValue | CellValue[]> = {};

      const buildCols = (): Record<string, CellValue[]> => {
        const cols: Record<string, CellValue[]> = {};
        for (const header of headers) {
          cols[header] = objectRows.map((row) => row[header]);
        }
        return cols;
      };

      for (const step of this.#steps) {
        if (step.kind === "agg") {
          aggs[step.name] = step.fn(buildCols(), aggs);
        } else if (step.kind === "aggRow") {
          aggs[step.name] = step.fn(buildCols(), aggs);
        } else {
          if (headers.includes(step.name)) {
            throw new Error(`Column "${step.name}" already exists in headers.`);
          }
          for (let i = 0; i < objectRows.length; i++) {
            step.fn(objectRows[i], aggs);
            objectRows[i][step.name] = step.fn(objectRows[i], aggs);
          }
          headers.push(step.name);
        }
      }

      return;
    }

    const arrayRows = rows as CellValue[][];
    for (const row of arrayRows) {
      if (row.length !== headers.length) {
        throw new Error(
          `Row length ${String(row.length)} does not match headers length ${String(headers.length)}.`,
        );
      }
    }

    // Build the initial column map from headers + rows (column-oriented view).
    // This is rebuilt lazily as needed for aggregate steps.
    const buildCols = (): Record<string, CellValue[]> => {
      const cols: Record<string, CellValue[]> = {};
      for (let c = 0; c < headers.length; c++) {
        cols[headers[c]] = arrayRows.map((row) => row[c]);
      }
      return cols;
    };

    const aggs: Record<string, CellValue | CellValue[]> = {};

    for (const step of this.#steps) {
      if (step.kind === "agg") {
        aggs[step.name] = step.fn(buildCols(), aggs);
      } else if (step.kind === "aggRow") {
        aggs[step.name] = step.fn(buildCols(), aggs);
      } else {
        if (headers.includes(step.name)) {
          throw new Error(`Column "${step.name}" already exists in headers.`);
        }
        for (let i = 0; i < arrayRows.length; i++) {
          const row = arrayRows[i];
          const snapshot: Record<string, CellValue> = {};
          for (let c = 0; c < headers.length; c++) {
            snapshot[headers[c]] = row[c];
          }
          row.push(step.fn(snapshot, aggs));
        }
        headers.push(step.name);
      }
    }
  }
}
