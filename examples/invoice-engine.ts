import { Engine } from "../src/engine.js"
import type { ExprCompiler, CellValue } from "../src/engine.js"
import { compile, sum } from "mathjs"

type InvoiceInput = {
    name: string[];
    cost: number[];
    qty: number[];
    offer: number[];
};

const mathCompiler: ExprCompiler = (expression) => {
    const compiled = compile(expression);
    return (scope) => compiled.evaluate(scope) as CellValue | CellValue[];
};

// Per-invoice computation engine.  Bind each invoice with .bind(), then evaluate.
export const invoiceEngine = new Engine<InvoiceInput>(mathCompiler)
    .def("line_cost",       row => row.cost * row.qty)      // JS expression
    .agg("total_cost",      "sum(line_cost)")               // mathjs string expression
    .agg("total_offer",     "sum(offer)")
    .def("gross_margin",    row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin", "line_cost/total_cost")
    .agg("total_mw",        cols => sum(cols.weighted_margin as number[]))
    .def("margin_score",    row => row.gross_margin < 0.3 ? '👎' : '👍');

// Cross-invoice analytics engine.  Use invoiceGroupEngine.bindX(boundEngines, cardinalsTarget)
// to chain it onto any number of pre-evaluated invoice BoundEngines.
//
// Step ordering (strict declaration order, each step iterates all tables before the next):
//   1. .agg()     — per table: invoice_gross_margin and invoice_weighted_margin written to
//                   each bound engine's own .aggs so the outer template can read them directly.
//   2. .cardinal() — once across all tables: grand_* values written to cardinalsTarget AND
//                   to every upstream .aggs (so the later .agg() can read grand_cost).
//
// Because cardinals are written back to upstream .aggs, invoice_weighted_margin can reference
// grand_cost even though it is declared after the cardinals.
export const invoiceGroupEngine = new Engine<Record<string, CellValue[]>>()
    .agg("invoice_gross_margin",
        (_cols, aggs) => {
            // aggs carries scalar values from invoiceEngine: total_cost, total_offer, etc.
            const a = aggs as unknown as Record<string, number>;
            return 1 - a.total_cost / a.total_offer;
        })
    .cardinal("grand_qty",
        cols => sum(cols["qty"] as number[]))
    .cardinal("grand_cost",
        (_cols, aggs) => sum(aggs["total_cost"] as number[]))
    .cardinal("grand_offer",
        (_cols, aggs) => sum(aggs["total_offer"] as number[]))
    .cardinal("grand_margin",
        (_cols, _aggs, cards) =>
            1 - (cards["grand_cost"] as number) / (cards["grand_offer"] as number))
    .agg("invoice_weighted_margin",
        (_cols, aggs) => {
            // grand_cost was written to this table's aggs by the cardinal step above.
            const a = aggs as unknown as Record<string, number>;
            return a.total_cost / a.grand_cost;
        });
