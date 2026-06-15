import type { CellValue, AggFn, AggRowFn, Row, RowGet } from "./expr.js";
export type { CellValue, AggFn, AggRowFn, Row, RowGet };

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
  fn: (row: Row, aggs: Record<string, CellValue | CellValue[]>) => CellValue;
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
    fn: (row: Cols & { [K in keyof Input]: Input[K][number] } & { get: RowGet }, aggs: Aggs) => V,
  ): Engine<Input, Val, Cols & Record<Name, V>, Aggs>
  def<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): Engine<Input, Val, Cols & Record<Name, Val>, Aggs>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeDefFn(fnOrExpr) : fnOrExpr;
    const step: DefStep = { kind: "def", name, fn: fn as DefStep["fn"] };
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeAggRowFn(fnOrExpr) : fnOrExpr;
    const step: AggRowStep = { kind: "aggRow", name, fn: fn as AggRowFn };
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
  /**
   * Evaluates all steps against the supplied row objects, mutating them in-place.
   *
   * Column names are derived from the keys of the first row; no `headers` array
   * is required. New computed properties are assigned directly onto each object.
   *
   * @param rows - Mutable object rows. Each object must contain input column keys.
   * @throws `{Error}` if a def name already exists as a key on the row objects.
   */
  evaluate(rows: Array<Record<string, Val>>): void;
  evaluate(
    headersOrRows: string[] | Array<Record<string, CellValue>>,
    rows?: CellValue[][] | Array<Record<string, CellValue>>,
  ): void {
    // ── Headerless object-row path ────────────────────────────────────────────
    if (rows === undefined) {
      const objectRows = headersOrRows as Array<Record<string, CellValue>>;
      const aggs: Record<string, CellValue | CellValue[]> = {};

      // Upfront duplicate-name validation — fails before any mutation
      if (objectRows.length > 0) {
        const keySet = new Set(Object.keys(objectRows[0]));
        for (const step of this.#steps) {
          if (step.kind === "def") {
            if (keySet.has(step.name)) throw new Error(`Column "${step.name}" already exists.`);
            keySet.add(step.name);
          }
        }
      }

      const buildCols = (): Record<string, CellValue[]> => {
        const cols: Record<string, CellValue[]> = {};
        if (objectRows.length > 0) {
          for (const key of Object.keys(objectRows[0])) {
            cols[key] = objectRows.map((row) => row[key]);
          }
        }
        return cols;
      };

      let cols: Record<string, CellValue[]> | null = null;
      let rowIndex = 0;

      const rowGet = (
        offsetOrFilter: number | ((row: Record<string, CellValue>) => boolean),
      ): Record<string, CellValue> | undefined => {
        if (typeof offsetOrFilter === "function") {
          for (let i = 0; i < objectRows.length; i++) {
            if (offsetOrFilter(objectRows[i])) return objectRows[i];
          }
          return undefined;
        }
        const target = rowIndex + offsetOrFilter;
        if (target < 0 || target >= objectRows.length) return undefined;
        return objectRows[target];
      };

      for (const step of this.#steps) {
        if (step.kind === "agg") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else if (step.kind === "aggRow") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else {
          cols = null;
          for (rowIndex = 0; rowIndex < objectRows.length; rowIndex++) {
            const objectRow = objectRows[rowIndex];
            const rowWithGet: Row = { ...objectRow, get: rowGet };
            objectRow[step.name] = step.fn(rowWithGet, aggs);
          }
        }
      }
      return;
    }

    const headers = headersOrRows as string[];

    // ── With-headers object-row path ──────────────────────────────────────────
    if (rows.length > 0 && !Array.isArray(rows[0])) {
      const objectRows = rows as Array<Record<string, CellValue>>;
      const aggs: Record<string, CellValue | CellValue[]> = {};

      // Upfront duplicate-name validation — fails before any mutation
      const headerSet = new Set(headers);
      for (const step of this.#steps) {
        if (step.kind === "def") {
          if (headerSet.has(step.name))
            throw new Error(`Column "${step.name}" already exists in headers.`);
          headerSet.add(step.name);
        }
      }

      const buildCols = (): Record<string, CellValue[]> => {
        const cols: Record<string, CellValue[]> = {};
        for (const header of headers) {
          cols[header] = objectRows.map((row) => row[header]);
        }
        return cols;
      };

      let cols: Record<string, CellValue[]> | null = null;
      let rowIndex = 0;

      const rowGet = (
        offsetOrFilter: number | ((row: Record<string, CellValue>) => boolean),
      ): Record<string, CellValue> | undefined => {
        if (typeof offsetOrFilter === "function") {
          for (let i = 0; i < objectRows.length; i++) {
            if (offsetOrFilter(objectRows[i])) return objectRows[i];
          }
          return undefined;
        }
        const target = rowIndex + offsetOrFilter;
        if (target < 0 || target >= objectRows.length) return undefined;
        return objectRows[target];
      };

      for (const step of this.#steps) {
        if (step.kind === "agg") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else if (step.kind === "aggRow") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else {
          cols = null;
          for (rowIndex = 0; rowIndex < objectRows.length; rowIndex++) {
            const objectRow = objectRows[rowIndex];
            const rowWithGet: Row = { ...objectRow, get: rowGet };
            objectRow[step.name] = step.fn(rowWithGet, aggs);
          }
          headers.push(step.name);
        }
      }
      return;
    }

    // ── Array-row path ────────────────────────────────────────────────────────
    const arrayRows = rows as CellValue[][];
    for (const row of arrayRows) {
      if (row.length !== headers.length) {
        throw new Error(
          `Row length ${String(row.length)} does not match headers length ${String(headers.length)}.`,
        );
      }
    }

    // Upfront duplicate-name validation — fails before any mutation
    const headerSet = new Set(headers);
    for (const step of this.#steps) {
      if (step.kind === "def") {
        if (headerSet.has(step.name))
          throw new Error(`Column "${step.name}" already exists in headers.`);
        headerSet.add(step.name);
      }
    }

    const buildCols = (): Record<string, CellValue[]> => {
      const cols: Record<string, CellValue[]> = {};
      for (let c = 0; c < headers.length; c++) {
        cols[headers[c]] = arrayRows.map((row) => row[c]);
      }
      return cols;
    };

    const aggs: Record<string, CellValue | CellValue[]> = {};
    let cols: Record<string, CellValue[]> | null = null;
    let rowIndex = 0;
    let currentStepName = "";

    const makeTargetSnapshot = (idx: number): Record<string, CellValue> => {
      const targetRow = arrayRows[idx];
      const result: Record<string, CellValue> = {};
      const baseCount = headers.length;
      for (let c = 0; c < baseCount && c < targetRow.length; c++) {
        result[headers[c]] = targetRow[c];
      }
      // Rows already processed in this step have the current step's value appended.
      if (idx < rowIndex && targetRow.length > baseCount) {
        result[currentStepName] = targetRow[baseCount];
      }
      return result;
    };

    const rowGet = (
      offsetOrFilter: number | ((row: Record<string, CellValue>) => boolean),
    ): Record<string, CellValue> | undefined => {
      if (typeof offsetOrFilter === "function") {
        for (let idx = 0; idx < arrayRows.length; idx++) {
          const snap = makeTargetSnapshot(idx);
          if (offsetOrFilter(snap)) return snap;
        }
        return undefined;
      }
      const target = rowIndex + offsetOrFilter;
      if (target < 0 || target >= arrayRows.length) return undefined;
      return makeTargetSnapshot(target);
    };

    const snapshotRow: Row = { get: rowGet };

    for (const step of this.#steps) {
      if (step.kind === "agg") {
        if (!cols) cols = buildCols();
        aggs[step.name] = step.fn(cols, aggs);
      } else if (step.kind === "aggRow") {
        if (!cols) cols = buildCols();
        aggs[step.name] = step.fn(cols, aggs);
      } else {
        currentStepName = step.name;
        cols = null;
        for (rowIndex = 0; rowIndex < arrayRows.length; rowIndex++) {
          const row = arrayRows[rowIndex];
          for (let c = 0; c < headers.length; c++) {
            snapshotRow[headers[c]] = row[c];
          }
          row.push(step.fn(snapshotRow, aggs));
        }
        headers.push(step.name);
      }
    }
  }

  /**
   * Binds this engine to a specific table, performing all upfront validation once.
   *
   * Returns a {@link BoundEngine} whose `evaluate()` can be called repeatedly without
   * re-passing the table. On each call, computed columns are truncated back to the
   * input length in-place and re-evaluated — no row recreation needed between calls.
   *
   * @param headers - Column name array. Must match the length of every row.
   * @param rows    - 2D row array. Held by reference; mutate cells between calls to
   *                  re-evaluate with updated input data.
   */
  bind(
    headers: string[],
    rows: Val[][],
    aggs?: Record<string, CellValue | CellValue[]>,
  ): BoundEngine {
    return new BoundEngine(this.#steps, headers, rows, aggs);
  }
}

/**
 * A computation engine pre-bound to a specific table.
 *
 * Obtained via {@link Engine.bind}. Validation (row lengths, duplicate column names)
 * runs once at construction time. Each `evaluate()` call truncates computed columns
 * back to the original input width in-place, then re-runs all steps — no row
 * recreation, no re-validation.
 *
 * @example
 * ```javascript
 * const seeds = Array.from({ length: 1000 }, Math.random);
 * const t = seeds.map(s => [s]);
 *
 * const ctx = new Engine()
 *   .def('doubled', r => r.seed * 2)
 *   .bind(['seed'], t);
 *
 * ctx.evaluate();          // t rows now have [seed, doubled]
 * t[0][0] = 0.99;          // mutate a seed value
 * ctx.evaluate();          // resets to [seed], recomputes — t[0] reflects new seed
 * ```
 * @beta
 */
export class BoundEngine {
  readonly #steps: Step[];
  readonly #headers: string[];
  readonly #rows: CellValue[][];
  readonly #inputColCount: number;
  readonly #snapshot: Row;
  readonly #aggsTarget: Record<string, CellValue | CellValue[]>;
  #rowIndex = 0;
  #currentStepName = "";

  /**
   * The aggregate values computed during the most recent `evaluate()` call.
   * Empty object before the first call. Keys match names passed to `.agg()` and `.aggRow()`.
   * This is the same object reference passed to `bind()` as the third argument (if any).
   */
  get aggs(): Record<string, CellValue | CellValue[]> {
    return this.#aggsTarget;
  }

  constructor(
    steps: Step[],
    headers: string[],
    rows: CellValue[][],
    aggsTarget?: Record<string, CellValue | CellValue[]>,
  ) {
    for (const row of rows) {
      if (row.length !== headers.length) {
        throw new Error(
          `Row length ${String(row.length)} does not match headers length ${String(headers.length)}.`,
        );
      }
    }
    const headerSet = new Set(headers);
    for (const step of steps) {
      if (step.kind === "def") {
        if (headerSet.has(step.name))
          throw new Error(`Column "${step.name}" already exists in headers.`);
        headerSet.add(step.name);
      }
    }
    this.#steps = steps;
    this.#headers = headers;
    this.#rows = rows;
    this.#inputColCount = headers.length;
    this.#aggsTarget = aggsTarget ?? {};
    this.#snapshot = {
      get: (
        offsetOrFilter: number | ((row: Record<string, CellValue>) => boolean),
      ): Record<string, CellValue> | undefined => {
        if (typeof offsetOrFilter === "function") {
          for (let idx = 0; idx < this.#rows.length; idx++) {
            const snap = this.#makeTargetSnapshot(idx);
            if (offsetOrFilter(snap)) return snap;
          }
          return undefined;
        }
        const target = this.#rowIndex + offsetOrFilter;
        if (target < 0 || target >= this.#rows.length) return undefined;
        return this.#makeTargetSnapshot(target);
      },
    };
  }

  /** All columns in their current evaluated state — input columns plus any computed columns. */
  get cols(): Record<string, CellValue[]> {
    return this.#buildCols();
  }

  #buildCols(): Record<string, CellValue[]> {
    const cols: Record<string, CellValue[]> = {};
    for (let c = 0; c < this.#headers.length; c++) {
      cols[this.#headers[c]] = this.#rows.map((row) => row[c]);
    }
    return cols;
  }

  #makeTargetSnapshot(idx: number): Record<string, CellValue> {
    const targetRow = this.#rows[idx];
    const result: Record<string, CellValue> = {};
    const baseCount = this.#headers.length;
    for (let c = 0; c < baseCount && c < targetRow.length; c++) {
      result[this.#headers[c]] = targetRow[c];
    }
    if (idx < this.#rowIndex && targetRow.length > baseCount) {
      result[this.#currentStepName] = targetRow[baseCount];
    }
    return result;
  }

  /**
   * Truncates computed columns from the previous call, then re-evaluates all steps
   * against the bound table in-place.
   */
  evaluate(): void {
    this.#headers.length = this.#inputColCount;
    for (const row of this.#rows) {
      row.length = this.#inputColCount;
    }

    const aggs = this.#aggsTarget;
    const snapshot = this.#snapshot;
    let cols: Record<string, CellValue[]> | null = null;

    for (const step of this.#steps) {
      if (step.kind === "agg") {
        if (!cols) cols = this.#buildCols();
        aggs[step.name] = step.fn(cols, aggs);
      } else if (step.kind === "aggRow") {
        if (!cols) cols = this.#buildCols();
        aggs[step.name] = step.fn(cols, aggs);
      } else {
        cols = null;
        this.#currentStepName = step.name;
        for (this.#rowIndex = 0; this.#rowIndex < this.#rows.length; this.#rowIndex++) {
          const row = this.#rows[this.#rowIndex];
          for (let c = 0; c < this.#headers.length; c++) {
            snapshot[this.#headers[c]] = row[c];
          }
          row.push(step.fn(snapshot, aggs));
        }
        this.#headers.push(step.name);
      }
    }
  }
}

/**
 * Aggregates across a set of {@link BoundEngine} instances.
 *
 * Each `.agg()` / `.aggRow()` step receives:
 * - `cols` — every column from every engine concatenated into one array per column name
 * - `aggs` — per-engine aggregate values collected into arrays
 *   (scalar values become `[v1, v2, …]`; array values are flat-concatenated),
 *   plus any group-level aggregates already computed earlier in the chain
 *
 * Call each engine's own `evaluate()` before calling `engineGroup.evaluate()`.
 *
 * @beta
 */
export class EngineGroup {
  readonly #engines: BoundEngine[];
  readonly #steps: (AggStep | AggRowStep)[];
  readonly #aggsTarget: Record<string, CellValue | CellValue[]>;

  /**
   * The aggregate values computed during the most recent `evaluate()` call.
   * Empty before the first call. Keys match names passed to `.agg()` and `.aggRow()`.
   * This is the same object reference passed as the second constructor argument (if any).
   */
  get aggs(): Record<string, CellValue | CellValue[]> {
    return this.#aggsTarget;
  }

  constructor(engines: BoundEngine[], aggs?: Record<string, CellValue | CellValue[]>) {
    this.#engines = engines;
    this.#steps = [];
    this.#aggsTarget = aggs ?? {};
  }

  /** Adds a scalar aggregate step over all engines' merged columns and aggregates. */
  agg(name: string, fn: AggFn): this {
    this.#steps.push({ kind: "agg", name, fn });
    return this;
  }

  /** Adds a per-element aggregate step over all engines' merged columns and aggregates. */
  aggRow(name: string, fn: AggRowFn): this {
    this.#steps.push({ kind: "aggRow", name, fn });
    return this;
  }

  /**
   * Runs all group steps against the current state of the bound engines.
   * Does NOT call `evaluate()` on each engine — the caller controls that.
   */
  evaluate(): void {
    // Concatenate columns from every engine
    const cols: Record<string, CellValue[]> = {};
    for (const engine of this.#engines) {
      for (const [name, values] of Object.entries(engine.cols)) {
        cols[name] = name in cols ? cols[name].concat(values) : values.slice();
      }
    }

    // Collect per-engine aggs: scalars → array, arrays → flat concat
    const aggs: Record<string, CellValue | CellValue[]> = {};
    for (const engine of this.#engines) {
      for (const [name, value] of Object.entries(engine.aggs)) {
        if (Array.isArray(value)) {
          aggs[name] = name in aggs ? (aggs[name] as CellValue[]).concat(value) : value.slice();
        } else {
          aggs[name] = name in aggs ? (aggs[name] as CellValue[]).concat([value]) : [value];
        }
      }
    }

    // Run group steps; each result is added to aggs and written to the target
    for (const step of this.#steps) {
      const result = step.kind === "agg" ? step.fn(cols, aggs) : step.fn(cols, aggs);
      aggs[step.name] = result;
      this.#aggsTarget[step.name] = result;
    }
  }
}
