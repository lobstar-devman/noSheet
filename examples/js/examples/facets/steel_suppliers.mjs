"use strict";
/**
Calculate steel supply costs
*/
export default function(table, row, refs) {

    row.cost_per_m2 = () => row.steel_m2 + row.transport_m2;
    table.average_cost_per_m2 = () => AVERAGE(this.column('cost_per_m2'));
};