"use strict";
/**
Calculate line item cost from raw materials
*/
export default function(table, row, refs) {

    row.unit_cost = () => row.steel_m2 * (refs.manufacturing_cost_per_m2 + refs.average_steel_cost_m2);
};