# Intrinsic Properties Spec.

Engine .def statements are passed a row object containg scalar values that correspond to the columns of the current row being processed.

- There are some intrinsic scalar properties of the current row that are not available within the function or expression (fnOrExpr) passed to .def:
 * the current row index
 * the total number of rows in the table
 * the current column index

In the example below getters have been used, but the a different implementation is acceptable. 
The most important rule to observe is that any implementation doesn't mask the names of any columns.

 ```typescript
   const invoiceEngine = new Engine<{ cost: number[]; qty: number[] }>()
    .def("line_cost", (r) => r.cost * r.qty)
    .agg("total_cost", (cols) => (cols.line_cost as number[]).reduce((a, b) => a + b, 0))
    .def("packing_list", (r) => `item ${r.index()} of ${r.count()}: qty ${r.qty}`);
 ```

 # Current column index

 The current column index might be used as in the example shown below

 ```js
    let columns = 10,
        e = new Engine().def('seed', () => Math.random());

    for(let i = 0; i < columns; i++){
        e = e.def(`c${i}`, (r) => (r.seed + i) / f);
    }

    for(let i = 1; i < columns; i++){
        e = e.def( 'sum_previous_column', (r) => r[`c${i-1}`] + r[`c${i}`]);
    }

```        

Please Note: All examples supplied are javascript pseudocode and as such are untested.