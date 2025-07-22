"use strict";
/**
 * Consolidate table stack line items
 * 
 * @param {*} columns   Table columns query object
 * @param {*} refs      External references
 */
export default function(columns, refs) {

    /**
     * The total cost of all the line items in the table stack
     * @returns number
     */
    this.total_cost  = () => SUM( ...columns('line_cost') );

    /**
     * The total offer price of all the line items in the table stack
     * @returns number
     */
    this.total_offer = () => SUM( ...columns('line_offer') );

    /**
     * Total profit
     * @returns number
     */
    this.profit      = () => this.total_offer - this.total_cost;

    /**
     * The total Gross Margin
     * @returns number
     */
    this.gross_margin = () => 1 - (this.total_cost / this.total_offer);

    /**
     * Returns true if the total Gross Margin is below the system threshold
     * @returns boolean
     */
    this.low_margin_warning = () => this.gross_margin <= refs.low_margin_threshold / 100;            
};