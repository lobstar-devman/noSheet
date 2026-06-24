import { sum } from 'https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm';

// ── Module-level helpers ────────────────────────────────────────────────────────
function wrapAggsAsArrays(aggs) {
    const result = {};
    for (const [k, v] of Object.entries(aggs)) {
        result[k] = Array.isArray(v) ? v : [v];
    }
    return result;
}
function makeAggMeta(tableIndex, tableCount, aggsArray) {
    const get = (indexOrFilter) => {
        if (typeof indexOrFilter === "function") {
            for (const a of aggsArray) {
                if (indexOrFilter(a))
                    return a;
            }
            return undefined;
        }
        const target = tableIndex + indexOrFilter;
        if (target < 0 || target >= tableCount)
            return undefined;
        return aggsArray[target];
    };
    const upstream = (filter) => {
        const result = {};
        for (let i = 0; i < tableIndex; i++) {
            const a = aggsArray[i];
            if (!filter || filter(a)) {
                for (const [k, v] of Object.entries(a)) {
                    const vals = Array.isArray(v) ? v : [v];
                    result[k] = k in result ? result[k].concat(vals) : vals.slice();
                }
            }
        }
        return result;
    };
    return { tableIndex, tableCount, get, upstream };
}
function buildMergedCols(upstreams) {
    const merged = {};
    for (const up of upstreams) {
        for (const [k, v] of Object.entries(up.cols)) {
            merged[k] = k in merged ? merged[k].concat(v) : v.slice();
        }
    }
    return merged;
}
function buildCollectedAggs(upstreams) {
    const collected = {};
    for (const up of upstreams) {
        for (const [k, v] of Object.entries(up.aggs)) {
            const vals = Array.isArray(v) ? v : [v];
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
 * @typeParam Input     - The input table type (column arrays keyed by name).
 * @typeParam InputAggs - Upstream aggregate contract: per-table scalars produced by the engine
 *   this one chains onto. Declared values appear as typed keys on the `aggs` parameter in
 *   `.def()`, `.agg()`, and `.cardinal()` callbacks without any cast.
 * @typeParam Val       - The cell value type (default `CellValue`; use e.g. `BigNumber` for mathjs).
 * @typeParam Cols      - Accumulated row type (grows with each `.def()` call).
 * @typeParam Aggs      - Per-table aggregate type (grows with each `.agg()` call).
 * @typeParam Cards     - Cross-table cardinal type (grows with each `.cardinal()` call).
 *
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
    cardinal(name, fnOrExpr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const fn = typeof fnOrExpr === "string" ? this.#makeCardinalFn(fnOrExpr) : fnOrExpr;
        const step = { kind: "cardinal", name, fn: fn };
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
    #makeCardinalFn(expression) {
        const evaluate = this.#requireCompiler(expression);
        return (cols, aggs, cards) => evaluate({ ...cols, ...aggs, ...cards });
    }
    evaluate(headersOrRows, rows) {
        // ── Headerless object-row path ────────────────────────────────────────────
        if (rows === undefined) {
            const objectRows = headersOrRows;
            const aggs = {};
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
            const buildObjCols = () => {
                const c = {};
                if (objectRows.length > 0) {
                    for (const key of Object.keys(objectRows[0])) {
                        c[key] = objectRows.map((r) => r[key]);
                    }
                }
                return c;
            };
            let cols = null;
            let hlessRowIndex = 0;
            let colIndex = objectRows.length > 0 ? Object.keys(objectRows[0]).length : 0;
            const cards = {};
            const hlessGet = (offsetOrFilter) => {
                if (typeof offsetOrFilter === "function") {
                    for (const r of objectRows) {
                        if (offsetOrFilter(r))
                            return r;
                    }
                    return undefined;
                }
                const target = hlessRowIndex + offsetOrFilter;
                if (target < 0 || target >= objectRows.length)
                    return undefined;
                return objectRows[target];
            };
            const hlessUpstream = (filter) => {
                const result = {};
                for (let j = 0; j < hlessRowIndex; j++) {
                    const r = objectRows[j];
                    if (!filter || filter(r)) {
                        for (const [k, v] of Object.entries(r)) {
                            if (!(k in result))
                                result[k] = [];
                            result[k].push(v);
                        }
                    }
                }
                return result;
            };
            const hlessMeta = {
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
                    if (!cols)
                        cols = buildObjCols();
                    aggs[step.name] = step.fn(cols, aggs, singleAggMeta);
                }
                else if (step.kind === "cardinal") {
                    if (!cols)
                        cols = buildObjCols();
                    const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
                    aggs[step.name] = result;
                    cards[step.name] = result;
                }
                else {
                    cols = null;
                    hlessMeta.defOffset = defOffset;
                    hlessMeta.colIndex = colIndex;
                    for (hlessRowIndex = 0; hlessRowIndex < objectRows.length; hlessRowIndex++) {
                        hlessMeta.rowIndex = hlessRowIndex;
                        const objectRow = objectRows[hlessRowIndex];
                        const row = { ...objectRow };
                        objectRow[step.name] = step.fn(row, aggs, hlessMeta);
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
            const headerSet = new Set(headers);
            for (const step of this.#steps) {
                if (step.kind === "def") {
                    if (headerSet.has(step.name))
                        throw new Error(`Column "${step.name}" already exists in headers.`);
                    headerSet.add(step.name);
                }
            }
            const buildWithHdrCols = () => {
                const c = {};
                for (const h of headers)
                    c[h] = objectRows.map((r) => r[h]);
                return c;
            };
            let cols = null;
            let whRowIndex = 0;
            const cards = {};
            const whGet = (offsetOrFilter) => {
                if (typeof offsetOrFilter === "function") {
                    for (const r of objectRows) {
                        if (offsetOrFilter(r))
                            return r;
                    }
                    return undefined;
                }
                const target = whRowIndex + offsetOrFilter;
                if (target < 0 || target >= objectRows.length)
                    return undefined;
                return objectRows[target];
            };
            const whUpstream = (filter) => {
                const result = {};
                for (let j = 0; j < whRowIndex; j++) {
                    const r = objectRows[j];
                    if (!filter || filter(r)) {
                        for (const [k, v] of Object.entries(r)) {
                            if (!(k in result))
                                result[k] = [];
                            result[k].push(v);
                        }
                    }
                }
                return result;
            };
            const whMeta = {
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
                    if (!cols)
                        cols = buildWithHdrCols();
                    aggs[step.name] = step.fn(cols, aggs, singleAggMeta);
                }
                else if (step.kind === "cardinal") {
                    if (!cols)
                        cols = buildWithHdrCols();
                    const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
                    aggs[step.name] = result;
                    cards[step.name] = result;
                }
                else {
                    cols = null;
                    whMeta.defOffset = defOffset;
                    whMeta.colIndex = headers.length;
                    for (whRowIndex = 0; whRowIndex < objectRows.length; whRowIndex++) {
                        whMeta.rowIndex = whRowIndex;
                        const objectRow = objectRows[whRowIndex];
                        const row = { ...objectRow };
                        objectRow[step.name] = step.fn(row, aggs, whMeta);
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
        const headerSet = new Set(headers);
        for (const step of this.#steps) {
            if (step.kind === "def") {
                if (headerSet.has(step.name))
                    throw new Error(`Column "${step.name}" already exists in headers.`);
                headerSet.add(step.name);
            }
        }
        const buildArrayCols = () => {
            const c = {};
            for (let i = 0; i < headers.length; i++) {
                c[headers[i]] = arrayRows.map((r) => r[i]);
            }
            return c;
        };
        const aggs = {};
        let cols = null;
        let arrRowIndex = 0;
        let currentStepName = "";
        const cards = {};
        const makeArrSnapshot = (idx) => {
            const targetRow = arrayRows[idx];
            const result = {};
            const baseCount = headers.length;
            for (let c = 0; c < baseCount && c < targetRow.length; c++) {
                result[headers[c]] = targetRow[c];
            }
            if (idx < arrRowIndex && targetRow.length > baseCount) {
                result[currentStepName] = targetRow[baseCount];
            }
            return result;
        };
        const arrGet = (offsetOrFilter) => {
            if (typeof offsetOrFilter === "function") {
                for (let i = 0; i < arrayRows.length; i++) {
                    const snap = makeArrSnapshot(i);
                    if (offsetOrFilter(snap))
                        return snap;
                }
                return undefined;
            }
            const target = arrRowIndex + offsetOrFilter;
            if (target < 0 || target >= arrayRows.length)
                return undefined;
            return makeArrSnapshot(target);
        };
        const arrUpstream = (filter) => {
            const result = {};
            for (let j = 0; j < arrRowIndex; j++) {
                const snap = makeArrSnapshot(j);
                if (!filter || filter(snap)) {
                    for (const [k, v] of Object.entries(snap)) {
                        if (!(k in result))
                            result[k] = [];
                        result[k].push(v);
                    }
                }
            }
            return result;
        };
        const snapshotRow = {};
        const arrMeta = {
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
                if (!cols)
                    cols = buildArrayCols();
                aggs[step.name] = step.fn(cols, aggs, singleAggMeta);
            }
            else if (step.kind === "cardinal") {
                if (!cols)
                    cols = buildArrayCols();
                const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
                aggs[step.name] = result;
                cards[step.name] = result;
            }
            else {
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
    bind(headers, rows, aggs) {
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
    bindX(upstream, cardinals) {
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
        this.#snapshot = {};
        const boundGet = (offsetOrFilter) => {
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
        };
        const boundUpstream = (filter) => {
            const result = {};
            for (let idx = 0; idx < this.#rowIndex; idx++) {
                const snap = this.#makeTargetSnapshot(idx);
                if (!filter || filter(snap)) {
                    for (const [k, v] of Object.entries(snap)) {
                        if (!(k in result))
                            result[k] = [];
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
    get cols() {
        return this.#buildCols();
    }
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
    evaluate(_mode) {
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
        const cards = {};
        const aggMeta = makeAggMeta(0, 1, [aggs]);
        for (const step of this.#steps) {
            if (step.kind === "agg") {
                if (!cols)
                    cols = this.#buildCols();
                aggs[step.name] = step.fn(cols, aggs, aggMeta);
            }
            else if (step.kind === "cardinal") {
                if (!cols)
                    cols = this.#buildCols();
                const result = step.fn(cols, wrapAggsAsArrays(aggs), cards);
                aggs[step.name] = result;
                cards[step.name] = result;
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
    resetGroupColumns() {
        if (this.#headers.length > this.#ownWidth) {
            this.#headers.length = this.#ownWidth;
            for (const row of this.#rows) {
                row.length = this.#ownWidth;
            }
        }
    }
    appendColumn(name, computeValue, chainCtx) {
        if (this.#headers.includes(name)) {
            throw new Error(`Column "${name}" already exists in headers.`);
        }
        const ctx = chainCtx ?? { tableIndex: 0, tableCount: 1, defOffset: 0 };
        const colIndex = this.#headers.length;
        const rowCount = this.#rows.length;
        const headers = this.#headers;
        const rows = this.#rows;
        this.#currentStepName = name;
        const chainGet = (offsetOrFilter) => {
            if (typeof offsetOrFilter === "function") {
                for (let idx = 0; idx < rows.length; idx++) {
                    const snap = this.#makeTargetSnapshot(idx);
                    if (offsetOrFilter(snap))
                        return snap;
                }
                return undefined;
            }
            const target = this.#rowIndex + offsetOrFilter;
            if (target < 0 || target >= rows.length)
                return undefined;
            return this.#makeTargetSnapshot(target);
        };
        const chainUpstream = (filter) => {
            const result = {};
            for (let idx = 0; idx < this.#rowIndex; idx++) {
                const snap = this.#makeTargetSnapshot(idx);
                if (!filter || filter(snap)) {
                    for (const [k, v] of Object.entries(snap)) {
                        if (!(k in result))
                            result[k] = [];
                        result[k].push(v);
                    }
                }
            }
            return result;
        };
        const chainMeta = {
            rowIndex: 0,
            rowCount,
            defOffset: ctx.defOffset,
            colIndex,
            tableIndex: ctx.tableIndex,
            tableCount: ctx.tableCount,
            get: chainGet,
            upstream: chainUpstream,
        };
        const chainSnapshot = {};
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
class ChainedBoundEngine {
    #steps;
    #upstreams;
    #cardinalsTarget;
    #compiler;
    constructor(steps, upstreams, compiler, cardinalsTarget) {
        this.#steps = steps;
        this.#upstreams = upstreams;
        this.#compiler = compiler;
        this.#cardinalsTarget = cardinalsTarget ?? {};
    }
    get aggs() {
        return this.#cardinalsTarget;
    }
    get cols() {
        return buildMergedCols(this.#upstreams);
    }
    get rowCount() {
        return this.#upstreams.reduce((sum, up) => sum + up.rowCount, 0);
    }
    evaluate(mode = "cascade") {
        if (mode === "cascade") {
            for (const up of this.#upstreams)
                up.evaluate();
        }
        for (const up of this.#upstreams)
            up.resetGroupColumns();
        for (const key of Object.keys(this.#cardinalsTarget)) {
            delete this.#cardinalsTarget[key];
        }
        const tableCount = this.#upstreams.length;
        const cards = {};
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
            }
            else if (step.kind === "agg") {
                for (let tableIndex = 0; tableIndex < tableCount; tableIndex++) {
                    const upstream = this.#upstreams[tableIndex];
                    const aggMeta = makeAggMeta(tableIndex, tableCount, this.#upstreams.map((u) => u.aggs));
                    const result = step.fn(upstream.cols, upstream.aggs, aggMeta);
                    upstream.aggs[step.name] = result;
                }
            }
            else {
                for (let tableIndex = 0; tableIndex < tableCount; tableIndex++) {
                    const upstream = this.#upstreams[tableIndex];
                    upstream.appendColumn(step.name, (row, chainMeta) => step.fn(row, upstream.aggs, chainMeta), { tableIndex, tableCount, defOffset });
                }
                defOffset++;
            }
        }
    }
}

const numAdd = (a, b) => a + b;
// Per-invoice computation engine.  Bind each invoice with .bind(), then evaluate.
const invoiceEngine = new Engine()
    .def("line_cost", row => row.cost * row.qty)
    .agg("total_cost", cols => sum(cols.line_cost))
    .agg("total_offer", cols => sum(cols.offer))
    .def("gross_margin", row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin", (row, aggs) => row.line_cost / aggs.total_cost)
    .agg("total_mw", cols => sum(cols.weighted_margin))
    .def("margin_score", row => row.gross_margin < 0.3 ? '👎' : '👍');
// Cross-invoice analytics engine.  Use invoiceGroupEngine.bindX(boundEngines, cardinalsTarget)
// to chain it onto any number of pre-evaluated invoice BoundEngines.
//
// Step ordering (strict declaration order, each step iterates all tables before the next):
//   1. .agg()      — per table: writes invoice_gross_margin / invoice_weighted_margin to each
//                    bound engine's own .aggs so the outer template can read them directly.
//   2. .cardinal() — once across all tables: grand_* values written to cardinalsTarget AND
//                    to every upstream .aggs (so the later .agg() can read grand_cost).
//
// Because cardinals are written back to upstream .aggs, invoice_weighted_margin can reference
// grand_cost even though it is declared after the cardinals.
const invoiceGroupEngine = new Engine()
    .agg("invoice_gross_margin", (_cols, aggs) => 1 - aggs.total_cost / aggs.total_offer)
    .cardinal("grand_qty", cols => cols.qty.reduce(numAdd, 0))
    .cardinal("grand_cost", (_cols, aggs) => aggs.total_cost.reduce(numAdd, 0))
    .cardinal("grand_offer", (_cols, aggs) => aggs.total_offer.reduce(numAdd, 0))
    .cardinal("grand_margin", (_cols, _aggs, cards) => 1 - cards.grand_cost / cards.grand_offer)
    .agg("invoice_weighted_margin", (_cols, aggs) => aggs.total_cost / aggs.grand_cost);

export { invoiceEngine, invoiceGroupEngine };
