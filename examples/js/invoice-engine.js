import {Engine, EngineGroup} from "/nosheet.esm.js"
import * as math from "https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm"

function mathCompiler(expression) {
    const compiled = math.compile(expression);
    return (scope) => compiled.evaluate(scope);
}

export const invoiceEngine = new Engine(mathCompiler)
    .def("line_cost", row => row.cost * row.qty)
    .agg("total_cost", "sum(line_cost)")
    .agg("total_offer", "sum(offer)")
    .def("gross_margin", (row, aggs) => 1-(row.line_cost/row.offer))
    .def("weighted_margin", "line_cost/total_cost")
    .agg("total_mw", (cols) => math.sum(cols.weighted_margin))
    .def("margin_score", (row) => row.gross_margin < 0.3 ? '👎' : '👍');

export function makeInvoiceGroup(aggsTarget) {
    return new EngineGroup(invoiceEngine, mathCompiler, aggsTarget)
        .agg("grand_qty", "sum(qty)")
        .groupAgg("grand_cost",   (aggCols) => math.sum(aggCols.total_cost))
        .groupAgg("grand_offer",  (aggCols) => math.sum(aggCols.total_offer))
        .groupAgg("grand_margin", (_aggCols, aggs) => 1 - (aggs.grand_cost / aggs.grand_offer))
        .groupAggRow("invoice_gross_margin",    (aggCols) => aggCols.total_cost.map((tc, i) => 1 - (tc / aggCols.total_offer[i])))
        .groupAggRow("invoice_weighted_margin", (aggCols, aggs) => aggCols.total_cost.map(tc => tc / aggs.grand_cost));
}
