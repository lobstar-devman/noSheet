import { Engine, EngineGroup } from "../src/engine.js"
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

export const invoiceEngine = new Engine<InvoiceInput>(mathCompiler)
    .def("line_cost",      row => row.cost * row.qty)
    .agg("total_cost",     "sum(line_cost)")
    .agg("total_offer",    "sum(offer)")
    .def("gross_margin",   row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin","line_cost/total_cost")
    .agg("total_mw",       cols => sum(cols.weighted_margin as number[]))
    .def("margin_score",   row => row.gross_margin < 0.3 ? '👎' : '👍');

export function makeInvoiceGroup(aggsTarget: Record<string, CellValue | CellValue[]>) {
    return new EngineGroup(invoiceEngine, mathCompiler, aggsTarget)
        .agg("grand_qty",    "sum(qty)")
        .groupAgg("grand_cost",   aggCols => sum(aggCols.total_cost as number[]))
        .groupAgg("grand_offer",  aggCols => sum(aggCols.total_offer as number[]))
        .groupAgg("grand_margin", (_aggCols, aggs) => 1 - (aggs.grand_cost / aggs.grand_offer))
        .groupAggRow("invoice_gross_margin",
            aggCols => (aggCols.total_cost as number[]).map((tc, i) => 1 - (tc / (aggCols.total_offer as number[])[i])))
        .groupAggRow("invoice_weighted_margin",
            (aggCols, aggs) => (aggCols.total_cost as number[]).map(tc => tc / aggs.grand_cost));
}
