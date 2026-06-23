import type {
  CellValue,
  AggFn,
  AggMeta,
  AggMetaGet,
  CardinalFn,
  Row,
  RowGet,
  RowMeta,
  UpstreamAggs,
  UpstreamRows,
} from "./expr.js";
export type { CellValue, AggFn, AggMeta, CardinalFn, Row, RowGet, RowMeta, UpstreamAggs, UpstreamRows };

/**
 * Compiles an expression string into a reusable scope evaluator.
 * The outer call happens once per expression (pre-compilation);
 * the returned function is invoked once per row or column evaluation.
 *
 * @beta
 */
export type ExprCompiler<V extends CellValue = CellValue> = (expression: string) => (scope: Record<string, unknown>) => V | V[];

/**
 * Converts a table type (column arrays) to a row type (scalar values).
 *
 * @beta
 */
export type TableToRow<T extends Record<string, CellValue[]>> = {
  [K in keyof T]: T[K][number];
};

// ── Internal step discriminated union ─────────────────────────────────────────

/** @beta */
export type DefStep = {
  kind: "def";
  name: string;
  fn: (row: Row, aggs: Record<string, CellValue | CellValue[]>, meta: RowMeta) => CellValue;
};

/** @beta */
export type AggStep = {
  kind: "agg";
  name: string;
  fn: AggFn;
};

/** @beta */
export type CardinalStep = {
  kind: "cardinal";
  name: string;
  fn: CardinalFn;
};

/** @beta */
export type Step = DefStep | AggStep | CardinalStep;

// ── Module-level helpers ────────────────────────────────────────────────────────

function wrapAggsAsArrays(
  aggs: Record<string, CellValue | CellValue[]>,
): Record<string, CellValue[]> {
  const result: Record<string, CellValue[]> = {};
  for (const [k, v] of Object.entries(aggs)) {
    result[k] = Array.isArray(v) ? (v as CellValue[]) : [v as CellValue];
  }
  return result;
}

function makeAggMeta(
  tableIndex: number,
  tableCount: number,
  aggsArray: Array<Record<string, CellValue | CellValue[]>>,
): AggMeta {
  const get: AggMetaGet = (indexOrFilter) => {
    if (typeof indexOrFilter === "function") {
      for (const a of aggsArray) {
        if (indexOrFilter(a)) return a;
      }
      return undefined;
    }
    const target = tableIndex + indexOrFilter;
    if (target < 0 || target >= tableCount) return undefined;
    return aggsArray[target];
  };

  const upstream = (
    filter?: (aggs: Record<string, CellValue | CellValue[]>) => boolean,
  ): UpstreamAggs => {
    const result: UpstreamAggs = {};
    for (let i = 0; i < tableIndex; i++) {
      const a = aggsArray[i];
      if (!filter || filter(a)) {
        for (const [k, v] of Object.entries(a)) {
          const vals = Array.isArray(v) ? (v as CellValue[]) : [v as CellValue];
          result[k] = k in result ? result[k].concat(vals) : vals.slice();
        }
      }
    }
    return result;
  };

  return { tableIndex, tableCount, get, upstream };
}

function buildMergedCols(upstreams: BoundEngine[]): Record<string, CellValue[]> {
  const merged: Record<string, CellValue[]> = {};
  for (const up of upstreams) {
    for (const [k, v] of Object.entries(up.cols)) {
      merged[k] = k in merged ? merged[k].concat(v) : v.slice();
    }
  }
  return merged;
}

function buildCollectedAggs(upstreams: BoundEngine[]): Record<string, CellValue[]> {
  const collected: Record<string, CellValue[]> = {};
  for (const up of upstreams) {
    for (const [k, v] of Object.entries(up.aggs)) {
      const vals = Array.isArray(v) ? (v as CellValue[]) : [v as CellValue];
      collected[k] = k in collected ? collected[k].concat(vals) : vals.slice();
    }
  }
  return collected;
}

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * A typed computation engine that applies sequential row expressions and aggregate
 * expressions to tabular data.
 *
 * Three kinds of step can be chained in any order:
 *
 * - `.def(name, (row, aggs, meta) => value)` — row expression. Evaluated once per row.
 * - `.agg(name, (cols, aggs, aggMeta) => scalar)` — scalar aggregate. Evaluated once per table.
 * - `.cardinal(name, (cols, aggs, cards) => scalar)` — cross-table aggregate. Evaluated once
 *   across all tables (available after `.bindX()`).
 *
 * @typeParam Input - The input table type.
 * @typeParam Val   - The value type for all cells.
 * @typeParam Cols  - Accumulated row type (grows with each `.def()` call).
 * @typeParam Aggs  - Accumulated aggregate type (grows with each step).
 *
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

  def<Name extends string, V extends Val>(
    name: Name,
    fn: (
      row: Cols & { [K in keyof Input]: Input[K][number] },
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

  agg<Name extends string, V extends Val>(
    name: Name,
    fn: (
      cols: Input & { [K in keyof Cols]: Val[] },
      aggs: Aggs,
      aggMeta: AggMeta,
    ) => V,
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
   * Adds a cardinal (cross-table) aggregate. Evaluated once across all tables when
   * running via {@link ChainedBoundEngine}. In single-table mode its result is stored
   * in `aggs` as a scalar.
   */
  cardinal<Name extends string>(
    name: Name,
    fn: CardinalFn,
  ): Engine<Input, Val, Cols, Aggs & Record<Name, Val>>
  cardinal<Name extends string>(
    name: Name,
    expression: [Input] extends [Record<string, Val[]>] ? string : never,
  ): Engine<Input, Val, Cols, Aggs & Record<Name, Val>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cardinal(name: string, fnOrExpr: any): any {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const fn = typeof fnOrExpr === "string" ? this.#makeCardinalFn(fnOrExpr) : fnOrExpr;
    const step: CardinalStep = { kind: "cardinal", name, fn: fn as CardinalFn };
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

  #makeCardinalFn(expression: string): CardinalFn {
    const evaluate = this.#requireCompiler(expression);
    return (cols, aggs, cards) => evaluate({ ...cols, ...aggs, ...cards });
  }

  /**
   * Evaluates all steps against the supplied rows, mutating them in-place.
   */
  evaluate(headers: string[], rows: Val[][]): void;
  evaluate(headers: string[], rows: Array<Record<string, Val>>): void;
  evaluate(rows: Array<Record<string, Val>>): void;
  evaluate(
    headersOrRows: string[] | Array<Record<string, CellValue>>,
    rows?: CellValue[][] | Array<Record<string, CellValue>>,
  ): void {
    // ── Headerless object-row path ────────────────────────────────────────────
    if (rows === undefined) {
      const objectRows = headersOrRows as Array<Record<string, CellValue>>;
      const aggs: Record<string, CellValue | CellValue[]> = {};

      if (objectRows.length > 0) {
        const keySet = new Set(Object.keys(objectRows[0]));
        for (const step of this.#steps) {
          if (step.kind === "def") {
            if (keySet.has(step.name)) throw new Error(`Column "${step.name}" already exists.`);
            keySet.add(step.name);
          }
        }
      }

      const buildObjCols = (): Record<string, CellValue[]> => {
        const c: Record<string, CellValue[]> = {};
        if (objectRows.length > 0) {
          for (const key of Object.keys(objectRows[0])) {
            c[key] = objectRows.map((r) => r[key]);
          }
        }
        return c;
      };

      let cols: Record<string, CellValue[]> | null = null;
      let hlessRowIndex = 0;
      let colIndex = objectRows.length > 0 ? Object.keys(objectRows[0]).length : 0;
      const cards: Record<string, CellValue> = {};

      const hlessGet: RowGet = (offsetOrFilter) => {
        if (typeof offsetOrFilter === "function") {
          for (const r of objectRows) {
            if (offsetOrFilter(r)) return r;
          }
          return undefined;
        }
        const target = hlessRowIndex + offsetOrFilter;
        if (target < 0 || target >= objectRows.length) return undefined;
        return objectRows[target];
      };

      const hlessUpstream = (filter?: (r: Record<string, CellValue>) => boolean): UpstreamRows => {
        const result: UpstreamRows = {};
        for (let j = 0; j < hlessRowIndex; j++) {
          const r = objectRows[j];
          if (!filter || filter(r)) {
            for (const [k, v] of Object.entries(r)) {
              if (!(k in result)) result[k] = [];
              result[k].push(v);
            }
          }
        }
        return result;
      };

      const hlessMeta: RowMeta = {
        rowIndex: 0,
        rowCount: objectRows.length,
        defOffset: 0,
        colIndex,
        tableIndex: 0,
        tableCount: 1,
        get: hlessGet,
        upstream: hlessUpstream,
      };

      const singleAggMeta = makeAggMeta(0, 1, [aggs]);
      let defOffset = 0;

      for (const step of this.#steps) {
        if (step.kind === "agg") {
          if (!cols) cols = buildObjCols();
          aggs[step.name] = step.fn(cols, aggs, singleAggMeta);
        } else if (step.kind === "cardinal") {
          if (!cols) cols = buildObjCols();
          const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
          aggs[step.name] = result;
          cards[step.name] = result;
        } else {
          cols = null;
          hlessMeta.defOffset = defOffset;
          hlessMeta.colIndex = colIndex;
          for (hlessRowIndex = 0; hlessRowIndex < objectRows.length; hlessRowIndex++) {
            hlessMeta.rowIndex = hlessRowIndex;
            const objectRow = objectRows[hlessRowIndex];
            const row: Row = { ...objectRow };
            objectRow[step.name] = step.fn(row, aggs, hlessMeta);
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

      const headerSet = new Set(headers);
      for (const step of this.#steps) {
        if (step.kind === "def") {
          if (headerSet.has(step.name))
            throw new Error(`Column "${step.name}" already exists in headers.`);
          headerSet.add(step.name);
        }
      }

      const buildWithHdrCols = (): Record<string, CellValue[]> => {
        const c: Record<string, CellValue[]> = {};
        for (const h of headers) c[h] = objectRows.map((r) => r[h]);
        return c;
      };

      let cols: Record<string, CellValue[]> | null = null;
      let whRowIndex = 0;
      const cards: Record<string, CellValue> = {};

      const whGet: RowGet = (offsetOrFilter) => {
        if (typeof offsetOrFilter === "function") {
          for (const r of objectRows) {
            if (offsetOrFilter(r)) return r;
          }
          return undefined;
        }
        const target = whRowIndex + offsetOrFilter;
        if (target < 0 || target >= objectRows.length) return undefined;
        return objectRows[target];
      };

      const whUpstream = (filter?: (r: Record<string, CellValue>) => boolean): UpstreamRows => {
        const result: UpstreamRows = {};
        for (let j = 0; j < whRowIndex; j++) {
          const r = objectRows[j];
          if (!filter || filter(r)) {
            for (const [k, v] of Object.entries(r)) {
              if (!(k in result)) result[k] = [];
              result[k].push(v);
            }
          }
        }
        return result;
      };

      const whMeta: RowMeta = {
        rowIndex: 0,
        rowCount: objectRows.length,
        defOffset: 0,
        colIndex: headers.length,
        tableIndex: 0,
        tableCount: 1,
        get: whGet,
        upstream: whUpstream,
      };

      const singleAggMeta = makeAggMeta(0, 1, [aggs]);
      let defOffset = 0;

      for (const step of this.#steps) {
        if (step.kind === "agg") {
          if (!cols) cols = buildWithHdrCols();
          aggs[step.name] = step.fn(cols, aggs, singleAggMeta);
        } else if (step.kind === "cardinal") {
          if (!cols) cols = buildWithHdrCols();
          const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
          aggs[step.name] = result;
          cards[step.name] = result;
        } else {
          cols = null;
          whMeta.defOffset = defOffset;
          whMeta.colIndex = headers.length;
          for (whRowIndex = 0; whRowIndex < objectRows.length; whRowIndex++) {
            whMeta.rowIndex = whRowIndex;
            const objectRow = objectRows[whRowIndex];
            const row: Row = { ...objectRow };
            objectRow[step.name] = step.fn(row, aggs, whMeta);
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

    const headerSet = new Set(headers);
    for (const step of this.#steps) {
      if (step.kind === "def") {
        if (headerSet.has(step.name))
          throw new Error(`Column "${step.name}" already exists in headers.`);
        headerSet.add(step.name);
      }
    }

    const buildArrayCols = (): Record<string, CellValue[]> => {
      const c: Record<string, CellValue[]> = {};
      for (let i = 0; i < headers.length; i++) {
        c[headers[i]] = arrayRows.map((r) => r[i]);
      }
      return c;
    };

    const aggs: Record<string, CellValue | CellValue[]> = {};
    let cols: Record<string, CellValue[]> | null = null;
    let arrRowIndex = 0;
    let currentStepName = "";
    const cards: Record<string, CellValue> = {};

    const makeArrSnapshot = (idx: number): Record<string, CellValue> => {
      const targetRow = arrayRows[idx];
      const result: Record<string, CellValue> = {};
      const baseCount = headers.length;
      for (let c = 0; c < baseCount && c < targetRow.length; c++) {
        result[headers[c]] = targetRow[c];
      }
      if (idx < arrRowIndex && targetRow.length > baseCount) {
        result[currentStepName] = targetRow[baseCount];
      }
      return result;
    };

    const arrGet: RowGet = (offsetOrFilter) => {
      if (typeof offsetOrFilter === "function") {
        for (let i = 0; i < arrayRows.length; i++) {
          const snap = makeArrSnapshot(i);
          if (offsetOrFilter(snap)) return snap;
        }
        return undefined;
      }
      const target = arrRowIndex + offsetOrFilter;
      if (target < 0 || target >= arrayRows.length) return undefined;
      return makeArrSnapshot(target);
    };

    const arrUpstream = (filter?: (r: Record<string, CellValue>) => boolean): UpstreamRows => {
      const result: UpstreamRows = {};
      for (let j = 0; j < arrRowIndex; j++) {
        const snap = makeArrSnapshot(j);
        if (!filter || filter(snap)) {
          for (const [k, v] of Object.entries(snap)) {
            if (!(k in result)) result[k] = [];
            result[k].push(v);
          }
        }
      }
      return result;
    };

    const snapshotRow: Row = {};
    const arrMeta: RowMeta = {
      rowIndex: 0,
      rowCount: arrayRows.length,
      defOffset: 0,
      colIndex: headers.length,
      tableIndex: 0,
      tableCount: 1,
      get: arrGet,
      upstream: arrUpstream,
    };

    const singleAggMeta = makeAggMeta(0, 1, [aggs]);
    let defOffset = 0;

    for (const step of this.#steps) {
      if (step.kind === "agg") {
        if (!cols) cols = buildArrayCols();
        aggs[step.name] = step.fn(cols, aggs, singleAggMeta);
      } else if (step.kind === "cardinal") {
        if (!cols) cols = buildArrayCols();
        const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
        aggs[step.name] = result;
        cards[step.name] = result;
      } else {
        currentStepName = step.name;
        cols = null;
        arrMeta.defOffset = defOffset;
        arrMeta.colIndex = headers.length;
        for (arrRowIndex = 0; arrRowIndex < arrayRows.length; arrRowIndex++) {
          const row = arrayRows[arrRowIndex];
          for (let c = 0; c < headers.length; c++) {
            snapshotRow[headers[c]] = row[c];
          }
          arrMeta.rowIndex = arrRowIndex;
          row.push(step.fn(snapshotRow, aggs, arrMeta));
        }
        headers.push(step.name);
        defOffset++;
      }
    }
  }

  /**
   * Binds this engine to a specific table, performing all upfront validation once.
   */
  bind(
    headers: string[],
    rows: Val[][],
    aggs?: Record<string, CellValue | CellValue[]>,
  ): BoundEngine {
    return new BoundEngine(this.#steps, headers, rows, aggs);
  }

  /**
   * Chains this engine onto one or more upstream {@link BoundEngine}s.
   *
   * Derives headers, rows, and donor aggregates directly from the upstream engines.
   * Returns a {@link ChainedBoundEngine} with `.evaluate()`, `.aggs`, `.cols`, and `.rowCount`.
   *
   * @param upstream  - One or more upstream BoundEngine instances.
   * @param cardinals - Optional external object to receive cardinal results.
   */
  bindX(
    upstream: BoundEngine | BoundEngine[],
    cardinals?: Record<string, CellValue>,
  ): ChainedBoundEngine {
    const upstreams = Array.isArray(upstream) ? upstream : [upstream];
    return new ChainedBoundEngine(this.#steps, upstreams, this.#compiler, cardinals);
  }
}

// ── BoundEngine ───────────────────────────────────────────────────────────────

/**
 * A computation engine pre-bound to a specific table.
 *
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
    this.#snapshot = {};

    const boundGet: RowGet = (offsetOrFilter) => {
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
    };

    const boundUpstream = (
      filter?: (row: Record<string, CellValue>) => boolean,
    ): UpstreamRows => {
      const result: UpstreamRows = {};
      for (let idx = 0; idx < this.#rowIndex; idx++) {
        const snap = this.#makeTargetSnapshot(idx);
        if (!filter || filter(snap)) {
          for (const [k, v] of Object.entries(snap)) {
            if (!(k in result)) result[k] = [];
            result[k].push(v);
          }
        }
      }
      return result;
    };

    this.#meta = {
      rowIndex: 0,
      rowCount: rows.length,
      defOffset: 0,
      colIndex: headers.length,
      tableIndex: 0,
      tableCount: 1,
      get: boundGet,
      upstream: boundUpstream,
    };
  }

  get cols(): Record<string, CellValue[]> {
    return this.#buildCols();
  }

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

  evaluate(_mode?: "cascade" | "manual"): void {
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
    const cards: Record<string, CellValue> = {};
    const aggMeta = makeAggMeta(0, 1, [aggs]);

    for (const step of this.#steps) {
      if (step.kind === "agg") {
        if (!cols) cols = this.#buildCols();
        aggs[step.name] = step.fn(cols, aggs, aggMeta);
      } else if (step.kind === "cardinal") {
        if (!cols) cols = this.#buildCols();
        const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
        aggs[step.name] = result;
        cards[step.name] = result;
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

  resetGroupColumns(): void {
    if (this.#headers.length > this.#ownWidth) {
      this.#headers.length = this.#ownWidth;
      for (const row of this.#rows) {
        row.length = this.#ownWidth;
      }
    }
  }

  appendColumn(
    name: string,
    computeValue: (row: Row, meta: RowMeta) => CellValue,
    chainCtx?: { tableIndex: number; tableCount: number; defOffset: number },
  ): void {
    if (this.#headers.includes(name)) {
      throw new Error(`Column "${name}" already exists in headers.`);
    }

    const ctx = chainCtx ?? { tableIndex: 0, tableCount: 1, defOffset: 0 };
    const colIndex = this.#headers.length;
    const rowCount = this.#rows.length;
    const headers = this.#headers;
    const rows = this.#rows;

    this.#currentStepName = name;

    const chainGet: RowGet = (offsetOrFilter) => {
      if (typeof offsetOrFilter === "function") {
        for (let idx = 0; idx < rows.length; idx++) {
          const snap = this.#makeTargetSnapshot(idx);
          if (offsetOrFilter(snap)) return snap;
        }
        return undefined;
      }
      const target = this.#rowIndex + offsetOrFilter;
      if (target < 0 || target >= rows.length) return undefined;
      return this.#makeTargetSnapshot(target);
    };

    const chainUpstream = (
      filter?: (row: Record<string, CellValue>) => boolean,
    ): UpstreamRows => {
      const result: UpstreamRows = {};
      for (let idx = 0; idx < this.#rowIndex; idx++) {
        const snap = this.#makeTargetSnapshot(idx);
        if (!filter || filter(snap)) {
          for (const [k, v] of Object.entries(snap)) {
            if (!(k in result)) result[k] = [];
            result[k].push(v);
          }
        }
      }
      return result;
    };

    const chainMeta: RowMeta = {
      rowIndex: 0,
      rowCount,
      defOffset: ctx.defOffset,
      colIndex,
      tableIndex: ctx.tableIndex,
      tableCount: ctx.tableCount,
      get: chainGet,
      upstream: chainUpstream,
    };

    const chainSnapshot: Row = {};

    for (this.#rowIndex = 0; this.#rowIndex < rowCount; this.#rowIndex++) {
      const row = rows[this.#rowIndex];
      for (let c = 0; c < headers.length; c++) {
        chainSnapshot[headers[c]] = row[c];
      }
      chainMeta.rowIndex = this.#rowIndex;
      row.push(computeValue(chainSnapshot, chainMeta));
    }
    headers.push(name);
  }
}

// ── ChainedBoundEngine ────────────────────────────────────────────────────────

/**
 * A computation engine chained onto one or more upstream {@link BoundEngine}s.
 * Obtained via {@link Engine.bindX}.
 *
 * @beta
 */
export class ChainedBoundEngine {
  readonly #steps: Step[];
  readonly #upstreams: BoundEngine[];
  readonly #cardinalsTarget: Record<string, CellValue>;
  readonly #compiler: ExprCompiler<CellValue> | undefined;

  constructor(
    steps: Step[],
    upstreams: BoundEngine[],
    compiler?: ExprCompiler<CellValue>,
    cardinalsTarget?: Record<string, CellValue>,
  ) {
    this.#steps = steps;
    this.#upstreams = upstreams;
    this.#compiler = compiler;
    this.#cardinalsTarget = cardinalsTarget ?? {};
  }

  get aggs(): Record<string, CellValue> {
    return this.#cardinalsTarget;
  }

  get cols(): Record<string, CellValue[]> {
    return buildMergedCols(this.#upstreams);
  }

  get rowCount(): number {
    return this.#upstreams.reduce((sum, up) => sum + up.rowCount, 0);
  }

  evaluate(mode: "cascade" | "manual" = "cascade"): void {
    if (mode === "cascade") {
      for (const up of this.#upstreams) up.evaluate();
    }

    for (const up of this.#upstreams) up.resetGroupColumns();

    for (const key of Object.keys(this.#cardinalsTarget)) {
      delete this.#cardinalsTarget[key];
    }

    const tableCount = this.#upstreams.length;
    const cards: Record<string, CellValue> = {};
    let defOffset = 0;

    for (const step of this.#steps) {
      if (step.kind === "cardinal") {
        const mergedCols = buildMergedCols(this.#upstreams);
        const collectedAggs = buildCollectedAggs(this.#upstreams);
        const result = step.fn(mergedCols, collectedAggs, cards);
        cards[step.name] = result;
        this.#cardinalsTarget[step.name] = result;
        for (const up of this.#upstreams) {
          up.aggs[step.name] = result;
        }
      } else if (step.kind === "agg") {
        for (let tableIndex = 0; tableIndex < tableCount; tableIndex++) {
          const upstream = this.#upstreams[tableIndex];
          const aggMeta = makeAggMeta(
            tableIndex,
            tableCount,
            this.#upstreams.map((u) => u.aggs),
          );
          const result = step.fn(upstream.cols, upstream.aggs, aggMeta);
          upstream.aggs[step.name] = result;
        }
      } else {
        for (let tableIndex = 0; tableIndex < tableCount; tableIndex++) {
          const upstream = this.#upstreams[tableIndex];
          upstream.appendColumn(
            step.name,
            (row, chainMeta) => step.fn(row, upstream.aggs, chainMeta),
            { tableIndex, tableCount, defOffset },
          );
        }
        defOffset++;
      }
    }
  }
}
