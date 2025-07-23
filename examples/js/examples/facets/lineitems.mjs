"use strict";
/**
A simple invoice/quotation calculator
*/
export default function(table, row) {

    row.line_cost     = () => row.quantity * row.unit_cost;    
    row.line_offer    = () => row.quantity * row.unit_offer;

    table.total_quantity = () => SUM(this.column('quantity'));
    table.total_cost     = () => SUM(this.column('line_cost'));
    table.total_offer    = () => SUM(this.column('line_offer'));
    table.profit         = () => table.total_offer - table.total_cost;
};