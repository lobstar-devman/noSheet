
# Removing the EngineGroup class and the .aggRow step

This spec explores the feasibility of removing the EngineGroup class and using the existing Engine class to achieve the same results.

It also describes a way to use multiple Engine definitions in a way that can be used to build a library of algorithms that work on tabular data.

Read the SPEC.md file to understand the current specification of the code and identify important terminology.

## Additional Terminology

- A step (or computational step) refers to a .def or .agg call
- Expression: The mathsjs expression string or javascript code used in a step arrow function.
- An Engine Definition: A `new Engine()` statement with a sequence of steps.
- Column Function: The arrow function passed to a .def step
- Aggregate Function: The arrow function passed to a .agg step
- Aggregates: The scalar computational results of .agg steps
- Computed donor table: The mutated donor table once it has been processed by a BoundEngine.evaluate() call
- Aggregate properties: The donor aggregates object once it has been processed by a BoundEngine.evaluate() call
- Upstream: Array rows, elements, steps that occur before the current array row, element or step.
- Upstream rows: Donor table rows that occur before the current row. If n is the current row index then all upstream rows have an index < n.
- Downstream rows: Donor table rows that occur after the current row. If n is the current row index then all downstream rows have an index > n
- Upstream cells: In the current donor table row where n is the current array element index; all upstream cells will have a cell index of < n.

## Donor Tables

Donor Tables are 2 dimensional arrays of n.m elements.

Engine definitions are sequences of steps that either append new columns to the donor table or define aggregate properties based on the mathematical or javascript expressions used in the definition.

Donor Tables are evaluated in Column-Major order by BoundEngines. The expressions in an Engine Definitions' computational steps have access to row and aggregate property operands that are constrained by the position of the currently executing engine step and the current table row being processed.

## The Engine class as a computational unit.

Engines are constructed using steps and then bound to donor tables and aggregate objects.

The BoundEngine class's evaluate function defines the smallest computational action that can be performed on a donor table via the API at run time.

The Engine definition can be described as a 'computational unit'; a sequence of steps that is performed on a donor table to produce an output:
(donor table, donor aggregates) ===> computational unit ===> (computed donor table, aggregate properties)

## Chaining Computational Units

This section discusses the concept of chaining computational units. This forms the basis of the next section 'Facets as computational units' where the idea is extended for implementation.

Take for example two different Engine Definitions (`EngineX` and `bindX` are used to indicate that the pseudocode is using `Engine` and `bind` in a new way not defined in the current SPEC.md):
```js
type InvoiceInput = {
    name:  string[];
    cost:  number[];
    qty:   number[];
    offer: number[];
};

const e1 = new Engine<InvoiceInput>()
    .def("line_cost",      row => row.cost * row.qty)
    .agg("total_cost",     (cols, aggs) => sum(cols.line_cost))
    .agg("total_offer",     (cols, aggs) => sum(cols.offer));

type ExpectedCols = {
    line_cost: number[];
    row_offer: number[];
};

type ExpectedAggs = {
    total_cost: number;
    total_offer: number;
};

const e2 = new EngineX<ExpectedCols, ExpectedAggs>()
    .def("gross_margin",   row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin", (row, aggs) => row.line_cost / aggs.total_cost),
    .agg("target_offer", (cols, aggs) => aggs.total_offer * 2);

var donor_table = [['item1', 10, 2, 20], ['item2', 30, 3, 60], ['item3', 40, 4, 80]],
    donor_aggregates = {};
    
var bound_e1 = e1.bind(
        ["name", "cost", "qty", "offer"],
        donor_table,
        donor_aggregates
    );    

var bound_e2 = e2.bindX(
                        donor_table,
                        donor_aggregates
                    );  
                    
bound_e1.evaluate();                   
bound_e2.evaluate();
```

The result of the two evaluate expressions will populate the donor table and aggregates object so that they match the code below:
```js
//donor table:
let expected_donor_table = [
    ['item1', 10, 2, 20, 20, 0, 0.125],
    ['item2', 30, 3, 60, 60, 0, 0.375],
    ['item3', 40, 4, 80, 80, 0, 0.5]
]

//donor aggregates:
let expected_donor_aggregates = {
    'total_cost': 160,
    'total_offer': 160,
    'target_offer': 320
}
```

Once both BoundEngines' evaluate functions have been called, any further calls, in any order, will be idempotent as the underlying donor table data is not changing.

In the pseudocode the new version of `Engine`: `EngineX` has access to the cols and aggregate definitions via its generic type definition in order to make them available in its steps.

Likewise, `bindX` doesn't need a header array passed to it as it already has this information passed in the `e2` statement.

### Removing .aggRow functions

A .def step appends a new column to each donor table passing a fixed set of operands to each expression.
A .agg step adds a new aggregate property passing a fixed set of operands to each expression.

If the .def step also has access array of upstream rows via the rowMeta object `rowMeta.upstream()` it could operate the same way as an .aggRow step.

This would have an impact on the implementation of row intrinsics implemented via RowMeta.

rowget ( offset/filter )
```js
const e2 = new EngineX<{...}>()
    .def("rolling_total",   row => sum(rowMeta.upstream().total))
```

Implementation note: To improve performance the upstream parameter should be passed as an iterator on the donor table with an index upper limit of n-1 (where n is the index of the donor table row).

### Facet Terminology

The donor table and aggregates can be modelled as a kernel of data with a shell of computation steps defined by one or more Engine definitions.

The Engine definitions then become 'facets' of the shell. Facets can be stored as computational libraries which programmers can apply to donor table and aggregate 'kernels'.

As with any sequence of mathematical expressions the order is important and must be consistent. Classes and helper functions that define this structure will be described in the 'Workflow section'

### Packing facets into external libraries

Engines can be packaged and exported using esm:
```js
export const invoiceEngine = new Engine<InvoiceInput>();
```

The packaged engine can also use externally set operands:

```js
export const config = {
  VAT: 20
};

export const invoiceEngine = new Engine<InvoiceInput>()
            .define('VAT', (row) => row.offer * config.VAT)

        :
        :
import { config } from './tax_calculations.js';
config.VAT = 17.5;         
```

## Nested donor tables and aggregates

If the `bind` function is extended to allow for nested donor tables and aggregates:
```js

var donor_table1 = [...],
    donor_aggregates1 = {},
    donor_table2 = [...],
    donor_aggregates2 = {},
    donor_table3 = [...],
    donor_aggregates3 = {};
    
var bound_engine = engine.bindX(
                        [donor_table1, donor_table2, donor_table3],
                        [donor_aggregates1, donor_aggregates2, donor_aggregates3]
                    );      
```

Then a single `BoundEngine` can perform the same work as multiple `BoundEngines` in the current codebase.

## Extending the .agg function with an aggMeta object

If the .agg function is passed aggMeta object that acts in the same way as the rowMeta object then it can also function as a per-aggregate aggregate.

```js
var total_agg_cost = [...aggMeta.upstream().total_cost];

```

## Using Nested donor tables and aggregates with a new Cardinal step

If .agg functions operate on the current donor table, cardinal steps operate on all donor table rows and donor table aggregate properties passed to the `bindX` function.

An Engine Definition with a cardinal step:
```js
export const engine = new Engine<{...}>()
            .cardinal('grand_total', (rows, aggs) => sum(agg.total_offer));

var cardinals = {}
var bound_engine = engine.bindX(
                        [donor_table1, donor_table2, donor_table2],
                        [donor_aggregates1, donor_aggregates2, donor_aggregates3],
                        cardinals
                    );      

//agg getter is relative to current table aggs?                    
```            

The parameters passed to a Cardinal step would be:
`cols` : All the cols in all the donor tables
`aggs` : All the aggregate objects packaged such that `aggs.total_offer` returns an array of all the agg.total_offer properties passed to the `bind` function
`cards`: Previously defined cardinals

## `bind` parameter count and return values.

If bind is passed three parameters; `(array, array, object)` then it is assumed it is in nested table mode and returns the populated cardinal object.

If bind is passed two parameters; `(array, object)` then it works as it's current implementation.

## Nested Donor table intrinsics and getters


## Converting an example using EngineGroup in the current codebase to the new codebase

An EngineGroup implementation using the current codebase:
```js
var invoiceEngine = new Engine<InvoiceInput>()
    .def("line_cost",       row => row.cost * row.qty)
    .agg("total_cost",      cols => sum(row.line_cost))
    .agg("total_offer",     cols => sum(row.offer))
    .def("gross_margin",    row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin", (row, aggs) => row.line_cost/ aggs.total_cost)
    .agg("total_mw",        cols => sum(cols.weighted_margin));

var invoiceGroupEngine = new EngineGroup(invoiceEngine, mathCompiler, aggsTarget)
        .agg("grand_qty",         aggs => sum(aggs.qty))
        .groupAgg("grand_cost",   aggCols => sum(aggCols.total_cost as number[]))
        .groupAgg("grand_offer",  aggCols => sum(aggCols.total_offer as number[]))
        .groupAgg("grand_margin", (_aggCols, aggs) => 1 - (aggs.grand_cost / aggs.grand_offer))
        .groupAggRow("invoice_gross_margin",
            aggCols => (aggCols.total_cost).map((tc, i) => 1 - (tc / (aggCols.total_offer as number[])[i])))
        .groupAggRow("invoice_weighted_margin",
            (aggCols, aggs) => (aggCols.total_cost).map(tc => tc / aggs.grand_cost));
```

Using the new codebase:
```js
var invoiceEngine = new Engine<InvoiceInput>()
    .def("line_cost",       row => row.cost * row.qty)
    .agg("total_cost",      cols => sum(row.line_cost))
    .agg("total_offer",     cols => sum(row.offer))
    .def("gross_margin",    row => 1 - (row.line_cost / row.offer))
    .def("weighted_margin", (row, aggs) => row.line_cost/ aggs.total_cost)
    .agg("total_mw",        cols => sum(cols.weighted_margin));

var engine = new Engine<{...}>()
    .agg("total_qty", cols => sum(cols.qty) ) //adds a new total_qty to each donor aggregate object
    .cardinal("grand_qty",     (cols, aggs, cards) => sum(aggs.total_qty))
    .cardinal("grand_cost",    (cols, aggs, cards) => sum(cols.total_cost))
    .cardinal("grand_offer",   (cols, aggs, cards) => sum(cols.total_offer));
    .cardinal("grand_margin",  (cols, aggs, cards) => 1 - (cards.grand_cost / cards.grand_offer));
    .agg("invoice_gross_margin",     (cols) => 1 - ( agg.total_cost / agg.total_offer) ) 
    .agg("invoice_weighted_margin",  (cols, aggs, cards) => row.total_cost / cards.grand_cost ) 

var donor_table1 = [...],
    donor_aggregates1 = {},
    donor_table2 = [...],
    donor_aggregates2 = {},
    donor_table3 = [...],
    donor_aggregates3 = {};

var bound_engine1 = invoiceEngine.bindX(
                        [donor_table1, donor_table2, donor_table3],
                        [donor_aggregates1, donor_aggregates2, donor_aggregates3]
                    );      

var grouped_invoice_aggregates = {},
    bound_engine2 = engine.bindX(
                        [donor_table1, donor_table2, donor_table3],
                        [donor_aggregates1, donor_aggregates2, donor_aggregates3],
                        grouped_invoice_aggregates
                    );      

bound_engine1.evaluate();                    
bound_engine2.evaluate();                    
```

# Intrinsics & getters

- The rowMeta parameter is still relevant and should operate the same way
- The new proposed aggMeta parameter should work similarly - but for nested donor aggregates.

# A note on iterators

Parameters passed to step functions should be implemented as iterators for performance reasons. Constructing arrays is expensive and maybe unnecessary if the parameter is not used.