import type { CellValue, AggFn, AggRowFn, Row, RowGet, RowMeta } from "./expr.js";
export type { CellValue, AggFn, AggRowFn, Row, RowGet, RowMeta };

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
  fn: (row: Row, aggs: Record<string, CellValue | CellValue[]>, meta: RowMeta) => CellValue;
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
   * @param fn   - Receives the current row (typed to `Cols`), all computed aggregates
   *               (typed to `Aggs`), and intrinsic row/column metadata (see {@link RowMeta}).
   *               Returns the value for this row.
   */
  def<Name extends string, V extends Val>(
    name: Name,
    fn: (
      row: Cols & { [K in keyof Input]: Input[K][number] } & { get: RowGet },
      aggs: Aggs,
      meta: RowMeta,
    ) => V,
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
      let colIndex = objectRows.length > 0 ? Object.keys(objectRows[0]).length : 0;
      const meta: RowMeta = { rowIndex: 0, rowCount: objectRows.length, defOffset: 0, colIndex };

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

      let defOffset = 0;
      for (const step of this.#steps) {
        if (step.kind === "agg") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else if (step.kind === "aggRow") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else {
          cols = null;
          meta.defOffset = defOffset;
          meta.colIndex = colIndex;
          for (rowIndex = 0; rowIndex < objectRows.length; rowIndex++) {
            meta.rowIndex = rowIndex;
            const objectRow = objectRows[rowIndex];
            const rowWithGet: Row = { ...objectRow, get: rowGet };
            objectRow[step.name] = step.fn(rowWithGet, aggs, meta);
          }
          defOffset++;
          colIndex++;
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
      const meta: RowMeta = {
        rowIndex: 0,
        rowCount: objectRows.length,
        defOffset: 0,
        colIndex: headers.length,
      };

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

      let defOffset = 0;
      for (const step of this.#steps) {
        if (step.kind === "agg") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else if (step.kind === "aggRow") {
          if (!cols) cols = buildCols();
          aggs[step.name] = step.fn(cols, aggs);
        } else {
          cols = null;
          meta.defOffset = defOffset;
          meta.colIndex = headers.length;
          for (rowIndex = 0; rowIndex < objectRows.length; rowIndex++) {
            meta.rowIndex = rowIndex;
            const objectRow = objectRows[rowIndex];
            const rowWithGet: Row = { ...objectRow, get: rowGet };
            objectRow[step.name] = step.fn(rowWithGet, aggs, meta);
          }
          headers.push(step.name);
          defOffset++;
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
    const meta: RowMeta = {
      rowIndex: 0,
      rowCount: arrayRows.length,
      defOffset: 0,
      colIndex: headers.length,
    };

    let defOffset = 0;
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
        meta.defOffset = defOffset;
        meta.colIndex = headers.length;
        for (rowIndex = 0; rowIndex < arrayRows.length; rowIndex++) {
          const row = arrayRows[rowIndex];
          for (let c = 0; c < headers.length; c++) {
            snapshotRow[headers[c]] = row[c];
          }
          meta.rowIndex = rowIndex;
          row.push(step.fn(snapshotRow, aggs, meta));
        }
        headers.push(step.name);
        defOffset++;
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
  readonly #meta: RowMeta;
  readonly #aggsTarget: Record<string, CellValue | CellValue[]>;
  #ownWidth: number;
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
    this.#ownWidth = headers.length;
    this.#meta = { rowIndex: 0, rowCount: rows.length, defOffset: 0, colIndex: headers.length };
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

  /** The number of rows in the bound table. */
  get rowCount(): number {
    return this.#rows.length;
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
    const meta = this.#meta;
    meta.rowCount = this.#rows.length;
    let cols: Record<string, CellValue[]> | null = null;
    let defOffset = 0;

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
        meta.defOffset = defOffset;
        meta.colIndex = this.#headers.length;
        for (this.#rowIndex = 0; this.#rowIndex < this.#rows.length; this.#rowIndex++) {
          const row = this.#rows[this.#rowIndex];
          for (let c = 0; c < this.#headers.length; c++) {
            snapshot[this.#headers[c]] = row[c];
          }
          meta.rowIndex = this.#rowIndex;
          row.push(step.fn(snapshot, aggs, meta));
        }
        this.#headers.push(step.name);
        defOffset++;
      }
    }

    this.#ownWidth = this.#headers.length;
  }

  /**
   * Truncates any columns appended by a previous {@link EngineGroup} pass, restoring
   * this engine's own evaluated width. Idempotent — safe to call even if nothing
   * was appended. Used internally by `EngineGroup.evaluate()`.
   */
  resetGroupColumns(): void {
    if (this.#headers.length > this.#ownWidth) {
      this.#headers.length = this.#ownWidth;
      for (const row of this.#rows) {
        row.length = this.#ownWidth;
      }
    }
  }

  /**
   * Appends one column on top of this engine's own evaluated columns, one row at a time.
   * Does not truncate first — call {@link resetGroupColumns} once before a batch of
   * `appendColumn` calls to clear any columns left over from a previous pass.
   * Used internally by `EngineGroup.evaluate()` to implement group-level `.def()` steps.
   *
   * @throws `{Error}` if `name` already exists in the current headers.
   */
  appendColumn(
    name: string,
    computeValue: (row: Row, rowIndex: number, rowCount: number, colIndex: number) => CellValue,
  ): void {
    if (this.#headers.includes(name)) {
      throw new Error(`Column "${name}" already exists in headers.`);
    }
    const snapshot = this.#snapshot;
    const colIndex = this.#headers.length;
    const rowCount = this.#rows.length;
    this.#currentStepName = name;
    for (this.#rowIndex = 0; this.#rowIndex < rowCount; this.#rowIndex++) {
      const row = this.#rows[this.#rowIndex];
      for (let c = 0; c < this.#headers.length; c++) {
        snapshot[this.#headers[c]] = row[c];
      }
      row.push(computeValue(snapshot, this.#rowIndex, rowCount, colIndex));
    }
    this.#headers.push(name);
  }
}

// ── EngineGroup ───────────────────────────────────────────────────────────────

/**
 * Absolute-index sibling-row access for a {@link BoundEngine} reached through
 * {@link EngineAccessor}. Unlike {@link RowGet} (relative to the current row),
 * `0` here always means the target engine's first row — there's no "current row"
 * that carries across engines with potentially different row counts.
 *
 * @beta
 */
export type AbsoluteRowGet = (
  indexOrFilter: number | ((row: Record<string, CellValue>) => boolean),
) => Record<string, CellValue> | undefined;

/**
 * Reaches a sibling {@link BoundEngine} within the same {@link EngineGroup}, relative
 * to the engine whose row is currently being processed by a `.def()` step
 * (`0` = itself, `-1` = the previous engine, `1` = the next one).
 * Returns `undefined` if `offset` is out of range.
 *
 * @example
 * ```javascript
 * row.engine(-1)?.get(0)              // first row of the previous engine's donor table
 * row.engine(1)?.aggs.an_aggregate    // an_aggregate from the next engine's donor aggregate
 * ```
 *
 * @beta
 */
export type EngineAccessor = (
  offset: number,
) => { get: AbsoluteRowGet; aggs: Record<string, CellValue | CellValue[]> } | undefined;

/**
 * The row snapshot passed to an {@link EngineGroup.def} expression: the usual {@link Row}
 * (same-engine `.get()` works exactly as it does for a plain `Engine`/`BoundEngine`),
 * plus `.engine()` for reaching sibling engines in the group.
 *
 * @beta
 */
export type GroupRow = Row & { engine: EngineAccessor };

/**
 * Intrinsic metadata passed to an {@link EngineGroup.def} expression — {@link RowMeta}'s
 * row/column fields (scoped to the engine currently being processed), plus the engine's
 * own position and the total number of engines in the group.
 *
 * @beta
 */
export type GroupRowMeta = RowMeta & {
  engineIndex: number;
  engineCount: number;
};

/**
 * @beta
 */
export type GroupDefFn = (
  row: GroupRow,
  aggs: Record<string, CellValue | CellValue[]>,
  meta: GroupRowMeta,
) => CellValue;

type GroupDefStep = { kind: "groupDef"; name: string; fn: GroupDefFn };
type GroupAggStep = { kind: "groupAgg"; name: string; fn: AggFn };
type GroupAggRowStep = { kind: "groupAggRow"; name: string; fn: AggRowFn };
type EngineGroupStep = AggStep | AggRowStep | GroupDefStep | GroupAggStep | GroupAggRowStep;

function makeEngineHandle(
  target: BoundEngine,
): { get: AbsoluteRowGet; aggs: Record<string, CellValue | CellValue[]> } {
  const get: AbsoluteRowGet = (
    indexOrFilter: number | ((row: Record<string, CellValue>) => boolean),
  ): Record<string, CellValue> | undefined => {
    const cols = target.cols;
    const rowCount = target.rowCount;
    const buildAt = (idx: number): Record<string, CellValue> => {
      const r: Record<string, CellValue> = {};
      for (const [name, values] of Object.entries(cols)) r[name] = values[idx];
      return r;
    };
    if (typeof indexOrFilter === "function") {
      for (let i = 0; i < rowCount; i++) {
        const r = buildAt(i);
        if (indexOrFilter(r)) return r;
      }
      return undefined;
    }
    if (indexOrFilter < 0 || indexOrFilter >= rowCount) return undefined;
    return buildAt(indexOrFilter);
  };
  return { get, aggs: target.aggs };
}

/**
 * Maps an Engine's aggregate type to the donor-aggregate table that {@link EngineGroup}
 * builds at `evaluate()` time: scalar aggregates become `Val[]` (one value per engine)
 * and array aggregates are flat-concatenated into `Val[]`.
 *
 * This is the default initial shape of `aggs` inside every group callback — it holds
 * the pre-seeded per-engine aggregates before the group adds its own aggregates via
 * `.agg()` / `.groupAgg()` etc.
 *
 * @beta
 */
export type CollectedAggs<
  A extends Record<string, CellValue | CellValue[]>,
  Val extends CellValue = CellValue,
> = { [K in keyof A]: Val[] };

/**
 * Aggregates across a set of {@link BoundEngine} instances that share the same
 * originating `Engine`.
 *
 * Build the group from a template `Engine` instance (for typing), then call
 * `.def()` / `.agg()` / `.groupAgg()` etc. to add steps. Each method returns a new
 * `EngineGroup` — the builder is immutable. Finally call `evaluate(engines)` with
 * the actual `BoundEngine` instances at runtime.
 *
 * - `.agg(name, (cols, aggs) => scalar)` / `.aggRow(name, (cols, aggs) => array)` —
 *   `cols` is every column from every engine's donor table concatenated; `aggs` starts
 *   as the {@link CollectedAggs} of the template engine's own aggregates (one array per
 *   key, one entry per engine) and grows as group-level aggregates are added.
 *
 * - `.groupAgg(name, (aggCols, aggs) => scalar)` / `.groupAggRow(...)` —
 *   like `.agg()` / `.aggRow()` but `aggCols` is *only* the per-engine collected
 *   donor-aggregate table (no row-level columns).
 *
 * - `.def(name, (row, aggs, meta) => value)` — appends one column to *every* engine's
 *   donor table. `row` includes `row.engine(offset)` for reaching sibling engines;
 *   `aggs` is the group's running aggregate map; `meta` adds `engineIndex` /
 *   `engineCount` to {@link RowMeta}.
 *
 * Call each engine's own `evaluate()` before calling `engineGroup.evaluate(engines)`.
 *
 * @typeParam Input     - Input table type (inferred from the template Engine).
 * @typeParam Val       - Cell value type (inferred from the template Engine).
 * @typeParam Cols      - Accumulated row type; grows with each `.def()` call.
 * @typeParam EngineAggs - The template Engine's own aggregate type; drives the initial
 *                        shape of `aggs` in all group callbacks via {@link CollectedAggs}.
 * @typeParam GroupAggs - Group-level aggregate type; starts as
 *                        `CollectedAggs<EngineAggs>` and grows with each group agg step.
 *
 * @beta
 */
export class EngineGroup<
  Input extends Record<string, CellValue[]>,
  Val extends CellValue = CellValue,
  Cols extends { [K in keyof Input]: Input[K][number] } = TableToRow<Input>,
  EngineAggs extends Record<string, Val | Val[]> = Record<never, never>,
  GroupAggs extends Record<string, Val | Val[]> = CollectedAggs<EngineAggs, Val>,
> {
  readonly #steps: EngineGroupStep[];
  readonly #compiler: ExprCompiler<Val> | undefined;
  readonly #aggsTarget: Record<string, CellValue | CellValue[]>;

  /**
   * The aggregate values computed during the most recent `evaluate()` call.
   * Empty before the first call. Keys match names passed to `.agg()`, `.aggRow()`,
   * `.groupAgg()`, and `.groupAggRow()`.
   * This is the same object reference passed as the second or third constructor argument (if any).
   */
  get aggs(): Record<string, CellValue | CellValue[]> {
    return this.#aggsTarget;
  }

  /**
   * @param engine   - Template engine whose type parameters drive IDE completion on
   *                   `row.<column>` and `aggs.<aggregate>` inside group callbacks.
   *                   Not used at runtime — pass any instance built from the same
   *                   `Engine` chain as the `BoundEngine`s you will supply to `evaluate()`.
   * @param aggs     - Optional external object to receive aggregate results.
   */
  constructor(engine: Engine<Input, Val, Cols, EngineAggs>, aggs?: Record<string, CellValue | CellValue[]>)
  /**
   * @param engine   - Template engine (see above).
   * @param compiler - Expression compiler (e.g. wrapping mathjs) enabling string
   *                   expressions on `.def()` / `.agg()` / `.aggRow()` / `.groupAgg()` /
   *                   `.groupAggRow()`. The outer call compiles once per expression;
   *                   the returned function is called per row/column evaluation.
   * @param aggs     - Optional external object to receive aggregate results.
   */
  constructor(engine: Engine<Input, Val, Cols, EngineAggs>, compiler: ExprCompiler<Val>, aggs?: Record<string, CellValue | CellValue[]>)
  constructor(steps: EngineGroupStep[], compiler?: ExprCompiler<Val>, aggs?: Record<string, CellValue | CellValue[]>)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(engineOrSteps: Engine<any, any, any, any> | EngineGroupStep[], compilerOrAggs?: ExprCompiler<any> | Record<string, CellValue | CellValue[]>, aggs?: Record<string, CellValue | CellValue[]>) {
    this.#steps = Array.isArray(engineOrSteps) ? engineOrSteps : [];
    if (typeof compilerOrAggs === "function") {
      this.#compiler = compilerOrAggs as ExprCompiler<Val>;
      this.#aggsTarget = aggs ?? {};
    } else {
      this.#compiler = undefined;
      this.#aggsTarget = compilerOrAggs ?? aggs ?? {};
    }
  }

  #requireCompiler(expression: string): (scope: Record<string, unknown>) => Val | Val[] {
    if (!this.#compiler) {
      throw new Error(
        `Expression "${expression}" requires a compiler. Pass one to the EngineGroup constructor: new EngineGroup(engine, compiler).`,
      );
    }
    return this.#compiler(expression);
  }

  #makeGroupDefFn(expression: string): GroupDefFn {
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
   * Appends a column to every engine's own donor table — see the class-level doc for details.
   * Returns a new `EngineGroup` whose `Cols` type has grown by one entry.
   */
  def<Name extends string, V extends Val>(
    name: Name,
    fn: (
      row: GroupRow & Cols & { [K in keyof Input]: Input[K][number] },
      aggs: GroupAggs,
      meta: GroupRowMeta,
    ) => V,
  ): EngineGroup<Input, Val, Cols & Record<Name, V>, EngineAggs, GroupAggs>
  def<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): EngineGroup<Input, Val, Cols & Record<Name, Val>, EngineAggs, GroupAggs>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeGroupDefFn(fnOrExpr) : fnOrExpr;
    const step: GroupDefStep = { kind: "groupDef", name, fn: fn as GroupDefFn };
    return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
  }

  /**
   * Adds a scalar aggregate over all engines' merged columns. Returns a new
   * `EngineGroup` whose `GroupAggs` type has grown by one entry.
   */
  agg<Name extends string, V extends Val>(
    name: Name,
    fn: (cols: Input & { [K in keyof Cols]: Val[] }, aggs: GroupAggs) => V,
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, V>>
  agg<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, Val>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agg(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeAggFn(fnOrExpr) : fnOrExpr;
    const step: AggStep = { kind: "agg", name, fn: fn as AggFn };
    return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
  }

  /**
   * Adds a per-row aggregate over all engines' merged columns. Returns a new
   * `EngineGroup` whose `GroupAggs` type has grown by one entry (typed as `V[]`).
   */
  aggRow<Name extends string, V extends Val>(
    name: Name,
    fn: (cols: Input & { [K in keyof Cols]: Val[] }, aggs: GroupAggs) => V[],
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, V[]>>
  aggRow<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, Val[]>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aggRow(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeAggRowFn(fnOrExpr) : fnOrExpr;
    const step: AggRowStep = { kind: "aggRow", name, fn: fn as AggRowFn };
    return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
  }

  /**
   * Adds a scalar aggregate over the per-engine donor-aggregate table
   * (`aggCols` is {@link CollectedAggs}`<EngineAggs>`, not merged row columns).
   * Returns a new `EngineGroup` whose `GroupAggs` type has grown by one entry.
   */
  groupAgg<Name extends string, V extends Val>(
    name: Name,
    fn: (aggCols: CollectedAggs<EngineAggs, Val>, aggs: GroupAggs) => V,
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, V>>
  groupAgg<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, Val>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  groupAgg(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeAggFn(fnOrExpr) : fnOrExpr;
    const step: GroupAggStep = { kind: "groupAgg", name, fn: fn as AggFn };
    return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
  }

  /**
   * Adds a per-engine aggregate over the per-engine donor-aggregate table.
   * Returns a new `EngineGroup` whose `GroupAggs` type has grown by one entry (typed as `V[]`).
   */
  groupAggRow<Name extends string, V extends Val>(
    name: Name,
    fn: (aggCols: CollectedAggs<EngineAggs, Val>, aggs: GroupAggs) => V[],
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, V[]>>
  groupAggRow<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): EngineGroup<Input, Val, Cols, EngineAggs, GroupAggs & Record<Name, Val[]>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  groupAggRow(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeAggRowFn(fnOrExpr) : fnOrExpr;
    const step: GroupAggRowStep = { kind: "groupAggRow", name, fn: fn as AggRowFn };
    return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
  }

  /**
   * Runs all group steps against the supplied bound engines.
   * Does NOT call `evaluate()` on each engine — the caller controls that.
   * Safe to call repeatedly with the same or different engine arrays.
   *
   * @param engines - The {@link BoundEngine} instances to aggregate. Each must have
   *                  already had its own `evaluate()` called.
   * @throws `{Error}` if a `.def()` name already exists in any engine's headers.
   */
  evaluate(engines: BoundEngine[]): void {
    for (const engine of engines) engine.resetGroupColumns();

    // Collect per-engine aggs: scalars → array, arrays → flat concat. Frozen for
    // the duration of this call — used as the donor-aggregate table for groupAgg/groupAggRow.
    const aggCols: Record<string, CellValue[]> = {};
    for (const engine of engines) {
      for (const [name, value] of Object.entries(engine.aggs)) {
        if (Array.isArray(value)) {
          const arr = value as CellValue[];
          aggCols[name] = name in aggCols ? aggCols[name].concat(arr) : arr.slice();
        } else {
          aggCols[name] = name in aggCols ? aggCols[name].concat([value]) : [value];
        }
      }
    }

    const aggs: Record<string, CellValue | CellValue[]> = { ...aggCols };

    // Upfront duplicate-name validation for .def() steps — fails before any mutation
    const headerSets = engines.map((engine) => new Set(Object.keys(engine.cols)));
    for (const step of this.#steps) {
      if (step.kind === "groupDef") {
        for (const headerSet of headerSets) {
          if (headerSet.has(step.name)) {
            throw new Error(`Column "${step.name}" already exists in an engine's headers.`);
          }
          headerSet.add(step.name);
        }
      }
    }

    let cols: Record<string, CellValue[]> | null = null;
    const buildCols = (): Record<string, CellValue[]> => {
      const merged: Record<string, CellValue[]> = {};
      for (const engine of engines) {
        for (const [name, values] of Object.entries(engine.cols)) {
          merged[name] = name in merged ? merged[name].concat(values) : values.slice();
        }
      }
      return merged;
    };

    let defOffset = 0;
    for (const step of this.#steps) {
      if (step.kind === "agg" || step.kind === "aggRow") {
        if (!cols) cols = buildCols();
        const result = step.fn(cols, aggs);
        aggs[step.name] = result;
        this.#aggsTarget[step.name] = result;
      } else if (step.kind === "groupAgg" || step.kind === "groupAggRow") {
        const result = step.fn(aggCols, aggs);
        aggs[step.name] = result;
        this.#aggsTarget[step.name] = result;
      } else {
        cols = null; // row-level data is about to change; invalidate the merged-cols cache
        this.#runGroupDef(step, aggs, defOffset, engines);
        defOffset++;
      }
    }
  }

  #runGroupDef(
    step: GroupDefStep,
    aggs: Record<string, CellValue | CellValue[]>,
    defOffset: number,
    engines: BoundEngine[],
  ): void {
    const engineCount = engines.length;
    for (let engineIndex = 0; engineIndex < engineCount; engineIndex++) {
      const accessor: EngineAccessor = (offset) => {
        const targetIdx = engineIndex + offset;
        if (targetIdx < 0 || targetIdx >= engineCount) return undefined;
        return makeEngineHandle(engines[targetIdx]);
      };
      engines[engineIndex].appendColumn(step.name, (row, rowIndex, rowCount, colIndex) => {
        const groupRow: GroupRow = { ...row, engine: accessor };
        const meta: GroupRowMeta = { rowIndex, rowCount, defOffset, colIndex, engineIndex, engineCount };
        return step.fn(groupRow, aggs, meta);
      });
    }
  }
}
