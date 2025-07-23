"use strict";
/**
 * Calculate the gross margin for line items and for the whole table
 * 
 * @param {*} table     Table query object
 * @param {*} row       The table row
 * @param {*} refs      External references
 */
export default function(table, row, refs) {

    /**
     * The row Gross Margin
     * @returns number
     */    
    row.gross_margin  = () => 1 - (row.unit_cost / row.unit_offer);

    /**
     * The total Gross Margin
     * @returns number
     */    
    table.gross_margin = () => 1 - (table.total_cost / table.total_offer);

    /**
     * Returns true if the total Gross Margin is below the system threshold
     * @returns boolean
     */    
    table.low_margin_warning = () => table.gross_margin <= refs.low_margin_threshold / 100;
};