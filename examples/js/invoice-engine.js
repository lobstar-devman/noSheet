import { sum, compile } from 'https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm';

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
class Engine {
    #steps;
    #compiler;
    constructor(stepsOrCompiler, compiler) {
        if (Array.isArray(stepsOrCompiler)) {
            this.#steps = stepsOrCompiler;
            this.#compiler = compiler;
        }
        else {
            this.#steps = [];
            this.#compiler = stepsOrCompiler;
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    def(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeDefFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "def", name, fn: fn };
        return new Engine([...this.#steps, step], this.#compiler);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agg(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeAggFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "agg", name, fn: fn };
        return new Engine([...this.#steps, step], this.#compiler);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aggRow(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeAggRowFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "aggRow", name, fn: fn };
        return new Engine([...this.#steps, step], this.#compiler);
    }
    #requireCompiler(expression) {
        if (!this.#compiler) {
            throw new Error(`Expression "${expression}" requires a compiler. Pass one to the Engine constructor: new Engine(compiler).`);
        }
        return this.#compiler(expression);
    }
    #makeDefFn(expression) {
        const evaluate = this.#requireCompiler(expression);
        return (row, aggs) => evaluate({ ...row, ...aggs });
    }
    #makeAggFn(expression) {
        const evaluate = this.#requireCompiler(expression);
        return (cols, aggs) => evaluate({ ...cols, ...aggs });
    }
    #makeAggRowFn(expression) {
        const evaluate = this.#requireCompiler(expression);
        return (cols, aggs) => evaluate({ ...cols, ...aggs });
    }
    evaluate(headersOrRows, rows) {
        // ── Headerless object-row path ────────────────────────────────────────────
        if (rows === undefined) {
            const objectRows = headersOrRows;
            const aggs = {};
            // Upfront duplicate-name validation — fails before any mutation
            if (objectRows.length > 0) {
                const keySet = new Set(Object.keys(objectRows[0]));
                for (const step of this.#steps) {
                    if (step.kind === "def") {
                        if (keySet.has(step.name))
                            throw new Error(`Column "${step.name}" already exists.`);
                        keySet.add(step.name);
                    }
                }
            }
            const buildCols = () => {
                const cols = {};
                if (objectRows.length > 0) {
                    for (const key of Object.keys(objectRows[0])) {
                        cols[key] = objectRows.map((row) => row[key]);
                    }
                }
                return cols;
            };
            let cols = null;
            let rowIndex = 0;
            let colIndex = objectRows.length > 0 ? Object.keys(objectRows[0]).length : 0;
            const meta = { rowIndex: 0, rowCount: objectRows.length, defOffset: 0, colIndex };
            const rowGet = (offsetOrFilter) => {
                if (typeof offsetOrFilter === "function") {
                    for (let i = 0; i < objectRows.length; i++) {
                        if (offsetOrFilter(objectRows[i]))
                            return objectRows[i];
                    }
                    return undefined;
                }
                const target = rowIndex + offsetOrFilter;
                if (target < 0 || target >= objectRows.length)
                    return undefined;
                return objectRows[target];
            };
            let defOffset = 0;
            for (const step of this.#steps) {
                if (step.kind === "agg") {
                    if (!cols)
                        cols = buildCols();
                    aggs[step.name] = step.fn(cols, aggs);
                }
                else if (step.kind === "aggRow") {
                    if (!cols)
                        cols = buildCols();
                    aggs[step.name] = step.fn(cols, aggs);
                }
                else {
                    cols = null;
                    meta.defOffset = defOffset;
                    meta.colIndex = colIndex;
                    for (rowIndex = 0; rowIndex < objectRows.length; rowIndex++) {
                        meta.rowIndex = rowIndex;
                        const objectRow = objectRows[rowIndex];
                        const rowWithGet = { ...objectRow, get: rowGet };
                        objectRow[step.name] = step.fn(rowWithGet, aggs, meta);
                    }
                    defOffset++;
                    colIndex++;
                }
            }
            return;
        }
        const headers = headersOrRows;
        // ── With-headers object-row path ──────────────────────────────────────────
        if (rows.length > 0 && !Array.isArray(rows[0])) {
            const objectRows = rows;
            const aggs = {};
            // Upfront duplicate-name validation — fails before any mutation
            const headerSet = new Set(headers);
            for (const step of this.#steps) {
                if (step.kind === "def") {
                    if (headerSet.has(step.name))
                        throw new Error(`Column "${step.name}" already exists in headers.`);
                    headerSet.add(step.name);
                }
            }
            const buildCols = () => {
                const cols = {};
                for (const header of headers) {
                    cols[header] = objectRows.map((row) => row[header]);
                }
                return cols;
            };
            let cols = null;
            let rowIndex = 0;
            const meta = {
                rowIndex: 0,
                rowCount: objectRows.length,
                defOffset: 0,
                colIndex: headers.length,
            };
            const rowGet = (offsetOrFilter) => {
                if (typeof offsetOrFilter === "function") {
                    for (let i = 0; i < objectRows.length; i++) {
                        if (offsetOrFilter(objectRows[i]))
                            return objectRows[i];
                    }
                    return undefined;
                }
                const target = rowIndex + offsetOrFilter;
                if (target < 0 || target >= objectRows.length)
                    return undefined;
                return objectRows[target];
            };
            let defOffset = 0;
            for (const step of this.#steps) {
                if (step.kind === "agg") {
                    if (!cols)
                        cols = buildCols();
                    aggs[step.name] = step.fn(cols, aggs);
                }
                else if (step.kind === "aggRow") {
                    if (!cols)
                        cols = buildCols();
                    aggs[step.name] = step.fn(cols, aggs);
                }
                else {
                    cols = null;
                    meta.defOffset = defOffset;
                    meta.colIndex = headers.length;
                    for (rowIndex = 0; rowIndex < objectRows.length; rowIndex++) {
                        meta.rowIndex = rowIndex;
                        const objectRow = objectRows[rowIndex];
                        const rowWithGet = { ...objectRow, get: rowGet };
                        objectRow[step.name] = step.fn(rowWithGet, aggs, meta);
                    }
                    headers.push(step.name);
                    defOffset++;
                }
            }
            return;
        }
        // ── Array-row path ────────────────────────────────────────────────────────
        const arrayRows = rows;
        for (const row of arrayRows) {
            if (row.length !== headers.length) {
                throw new Error(`Row length ${String(row.length)} does not match headers length ${String(headers.length)}.`);
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
        const buildCols = () => {
            const cols = {};
            for (let c = 0; c < headers.length; c++) {
                cols[headers[c]] = arrayRows.map((row) => row[c]);
            }
            return cols;
        };
        const aggs = {};
        let cols = null;
        let rowIndex = 0;
        let currentStepName = "";
        const makeTargetSnapshot = (idx) => {
            const targetRow = arrayRows[idx];
            const result = {};
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
        const rowGet = (offsetOrFilter) => {
            if (typeof offsetOrFilter === "function") {
                for (let idx = 0; idx < arrayRows.length; idx++) {
                    const snap = makeTargetSnapshot(idx);
                    if (offsetOrFilter(snap))
                        return snap;
                }
                return undefined;
            }
            const target = rowIndex + offsetOrFilter;
            if (target < 0 || target >= arrayRows.length)
                return undefined;
            return makeTargetSnapshot(target);
        };
        const snapshotRow = { get: rowGet };
        const meta = {
            rowIndex: 0,
            rowCount: arrayRows.length,
            defOffset: 0,
            colIndex: headers.length,
        };
        let defOffset = 0;
        for (const step of this.#steps) {
            if (step.kind === "agg") {
                if (!cols)
                    cols = buildCols();
                aggs[step.name] = step.fn(cols, aggs);
            }
            else if (step.kind === "aggRow") {
                if (!cols)
                    cols = buildCols();
                aggs[step.name] = step.fn(cols, aggs);
            }
            else {
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
    bind(headers, rows, aggs) {
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
class BoundEngine {
    #steps;
    #headers;
    #rows;
    #inputColCount;
    #snapshot;
    #meta;
    #aggsTarget;
    #ownWidth;
    #rowIndex = 0;
    #currentStepName = "";
    /**
     * The aggregate values computed during the most recent `evaluate()` call.
     * Empty object before the first call. Keys match names passed to `.agg()` and `.aggRow()`.
     * This is the same object reference passed to `bind()` as the third argument (if any).
     */
    get aggs() {
        return this.#aggsTarget;
    }
    constructor(steps, headers, rows, aggsTarget) {
        for (const row of rows) {
            if (row.length !== headers.length) {
                throw new Error(`Row length ${String(row.length)} does not match headers length ${String(headers.length)}.`);
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
            get: (offsetOrFilter) => {
                if (typeof offsetOrFilter === "function") {
                    for (let idx = 0; idx < this.#rows.length; idx++) {
                        const snap = this.#makeTargetSnapshot(idx);
                        if (offsetOrFilter(snap))
                            return snap;
                    }
                    return undefined;
                }
                const target = this.#rowIndex + offsetOrFilter;
                if (target < 0 || target >= this.#rows.length)
                    return undefined;
                return this.#makeTargetSnapshot(target);
            },
        };
    }
    /** All columns in their current evaluated state — input columns plus any computed columns. */
    get cols() {
        return this.#buildCols();
    }
    /** The number of rows in the bound table. */
    get rowCount() {
        return this.#rows.length;
    }
    #buildCols() {
        const cols = {};
        for (let c = 0; c < this.#headers.length; c++) {
            cols[this.#headers[c]] = this.#rows.map((row) => row[c]);
        }
        return cols;
    }
    #makeTargetSnapshot(idx) {
        const targetRow = this.#rows[idx];
        const result = {};
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
    evaluate() {
        this.#headers.length = this.#inputColCount;
        for (const row of this.#rows) {
            row.length = this.#inputColCount;
        }
        const aggs = this.#aggsTarget;
        const snapshot = this.#snapshot;
        const meta = this.#meta;
        meta.rowCount = this.#rows.length;
        let cols = null;
        let defOffset = 0;
        for (const step of this.#steps) {
            if (step.kind === "agg") {
                if (!cols)
                    cols = this.#buildCols();
                aggs[step.name] = step.fn(cols, aggs);
            }
            else if (step.kind === "aggRow") {
                if (!cols)
                    cols = this.#buildCols();
                aggs[step.name] = step.fn(cols, aggs);
            }
            else {
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
    resetGroupColumns() {
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
    appendColumn(name, computeValue) {
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
function makeEngineHandle(target) {
    const get = (indexOrFilter) => {
        const cols = target.cols;
        const rowCount = target.rowCount;
        const buildAt = (idx) => {
            const r = {};
            for (const [name, values] of Object.entries(cols))
                r[name] = values[idx];
            return r;
        };
        if (typeof indexOrFilter === "function") {
            for (let i = 0; i < rowCount; i++) {
                const r = buildAt(i);
                if (indexOrFilter(r))
                    return r;
            }
            return undefined;
        }
        if (indexOrFilter < 0 || indexOrFilter >= rowCount)
            return undefined;
        return buildAt(indexOrFilter);
    };
    return { get, aggs: target.aggs };
}
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
class EngineGroup {
    #steps;
    #compiler;
    #aggsTarget;
    /**
     * The aggregate values computed during the most recent `evaluate()` call.
     * Empty before the first call. Keys match names passed to `.agg()`, `.aggRow()`,
     * `.groupAgg()`, and `.groupAggRow()`.
     * This is the same object reference passed as the second or third constructor argument (if any).
     */
    get aggs() {
        return this.#aggsTarget;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(engineOrSteps, compilerOrAggs, aggs) {
        this.#steps = Array.isArray(engineOrSteps) ? engineOrSteps : [];
        if (typeof compilerOrAggs === "function") {
            this.#compiler = compilerOrAggs;
            this.#aggsTarget = aggs ?? {};
        }
        else {
            this.#compiler = undefined;
            this.#aggsTarget = compilerOrAggs ?? aggs ?? {};
        }
    }
    #requireCompiler(expression) {
        if (!this.#compiler) {
            throw new Error(`Expression "${expression}" requires a compiler. Pass one to the EngineGroup constructor: new EngineGroup(engine, compiler).`);
        }
        return this.#compiler(expression);
    }
    #makeGroupDefFn(expression) {
        const evaluate = this.#requireCompiler(expression);
        return (row, aggs) => evaluate({ ...row, ...aggs });
    }
    #makeAggFn(expression) {
        const evaluate = this.#requireCompiler(expression);
        return (cols, aggs) => evaluate({ ...cols, ...aggs });
    }
    #makeAggRowFn(expression) {
        const evaluate = this.#requireCompiler(expression);
        return (cols, aggs) => evaluate({ ...cols, ...aggs });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    def(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeGroupDefFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "groupDef", name, fn: fn };
        return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agg(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeAggFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "agg", name, fn: fn };
        return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aggRow(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeAggRowFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "aggRow", name, fn: fn };
        return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    groupAgg(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeAggFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "groupAgg", name, fn: fn };
        return new EngineGroup([...this.#steps, step], this.#compiler, this.#aggsTarget);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    groupAggRow(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeAggRowFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "groupAggRow", name, fn: fn };
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
    evaluate(engines) {
        for (const engine of engines)
            engine.resetGroupColumns();
        // Collect per-engine aggs: scalars → array, arrays → flat concat. Frozen for
        // the duration of this call — used as the donor-aggregate table for groupAgg/groupAggRow.
        const aggCols = {};
        for (const engine of engines) {
            for (const [name, value] of Object.entries(engine.aggs)) {
                if (Array.isArray(value)) {
                    const arr = value;
                    aggCols[name] = name in aggCols ? aggCols[name].concat(arr) : arr.slice();
                }
                else {
                    aggCols[name] = name in aggCols ? aggCols[name].concat([value]) : [value];
                }
            }
        }
        const aggs = { ...aggCols };
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
        let cols = null;
        const buildCols = () => {
            const merged = {};
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
                if (!cols)
                    cols = buildCols();
                const result = step.fn(cols, aggs);
                aggs[step.name] = result;
                this.#aggsTarget[step.name] = result;
            }
            else if (step.kind === "groupAgg" || step.kind === "groupAggRow") {
                const result = step.fn(aggCols, aggs);
                aggs[step.name] = result;
                this.#aggsTarget[step.name] = result;
            }
            else {
                cols = null; // row-level data is about to change; invalidate the merged-cols cache
                this.#runGroupDef(step, aggs, defOffset, engines);
                defOffset++;
            }
        }
    }
    #runGroupDef(step, aggs, defOffset, engines) {
        const engineCount = engines.length;
        for (let engineIndex = 0; engineIndex < engineCount; engineIndex++) {
            const accessor = (offset) => {
                const targetIdx = engineIndex + offset;
                if (targetIdx < 0 || targetIdx >= engineCount)
                    return undefined;
                return makeEngineHandle(engines[targetIdx]);
            };
            engines[engineIndex].appendColumn(step.name, (row, rowIndex, rowCount, colIndex) => {
                const groupRow = { ...row, engine: accessor };
                const meta = { rowIndex, rowCount, defOffset, colIndex, engineIndex, engineCount };
                return step.fn(groupRow, aggs, meta);
            });
        }
    }
}

const mathCompiler = (expression) => {
    const compiled = compile(expression);
    return (scope) => compiled.evaluate(scope);
};
const invoiceEngine = new Engine(mathCompiler)
    .def("line_cost", row => row.cost * row.qty)
    .agg("total_cost", "sum(line_cost)")
    .agg("total_offer", "sum(offer)")
    .def("gross_margin", row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin", "line_cost/total_cost")
    .agg("total_mw", cols => sum(cols.weighted_margin))
    .def("margin_score", row => row.gross_margin < 0.3 ? '👎' : '👍');
function makeInvoiceGroup(aggsTarget) {
    return new EngineGroup(invoiceEngine, mathCompiler, aggsTarget)
        .agg("grand_qty", "sum(qty)")
        .groupAgg("grand_cost", aggCols => sum(aggCols.total_cost))
        .groupAgg("grand_offer", aggCols => sum(aggCols.total_offer))
        .groupAgg("grand_margin", (_aggCols, aggs) => 1 - (aggs.grand_cost / aggs.grand_offer))
        .groupAggRow("invoice_gross_margin", aggCols => aggCols.total_cost.map((tc, i) => 1 - (tc / aggCols.total_offer[i])))
        .groupAggRow("invoice_weighted_margin", (aggCols, aggs) => aggCols.total_cost.map(tc => tc / aggs.grand_cost));
}

export { invoiceEngine, makeInvoiceGroup };
