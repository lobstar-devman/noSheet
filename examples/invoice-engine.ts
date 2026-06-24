import { Engine } from "../src/engine.js"
import { sum } from "mathjs"

type InvoiceInput = {
    name: string[];
    cost: number[];
    qty: number[];
    offer: number[];
};

// All columns available to the cross-invoice engine: the original invoice input
// columns plus every def column that invoiceEngine computes.
type InvoiceRow = InvoiceInput & {
    line_cost: number[];
    gross_margin: number[];
    weighted_margin: number[];
    margin_score: string[];
};

// Aggregates produced by invoiceEngine that invoiceGroupEngine reads via aggs.
type InvoiceAggs = {
    total_cost: number;
    total_offer: number;
    total_mw: number;
};

// Per-invoice computation engine.  Bind each invoice with .bind(), then evaluate.
export const invoiceEngine = new Engine<InvoiceInput>()
    .def("line_cost",       row => row.cost * row.qty)
    .agg("total_cost",      cols => sum(cols.line_cost))
    .agg("total_offer",     cols => sum(cols.offer))
    .def("gross_margin",    row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin", (row, aggs) => row.line_cost / aggs.total_cost)
    .agg("total_mw",        cols => sum(cols.weighted_margin))
    .def("margin_score",    row => row.gross_margin < 0.3 ? '👎' : '👍');

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
export const invoiceGroupEngine = new Engine<InvoiceRow, InvoiceAggs>()
    .agg("invoice_gross_margin",
        (_cols, aggs) => 1 - aggs.total_cost / aggs.total_offer)
    .cardinal("grand_qty",
        cols => sum(cols.qty))
    .cardinal("grand_cost",
        (_cols, aggs) => sum(aggs.total_cost))
    .cardinal("grand_offer",
        (_cols, aggs) => sum(aggs.total_offer))
    .cardinal("grand_margin",
        (_cols, _aggs, cards) => 1 - cards.grand_cost / cards.grand_offer)
    .agg("invoice_weighted_margin",
        (_cols, aggs) => aggs.total_cost / aggs.grand_cost);
