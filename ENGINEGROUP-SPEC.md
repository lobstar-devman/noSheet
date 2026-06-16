# EngineGroup spec

## Terminology

The table object or array passed to a `BoundEngine` evaluate function is called a 'donor table'.
The aggregate object returned by a `BoundEngine` evaluate function is called a 'donor aggregate'.
The external aggregate object passed as the `aggs` parameter to `bind` is also called a 'donor aggregate'.

## The Role of The Engine Group

The EngineGroup's role is to process the output of a collection of BoundEngines that share the same Engine constructor.

The role of a BoundEngine is to append data to the supplied donor table and to generate a donor aggregate object.

* The new EngineGroup will work in exactly the same way, with the important following distinctions:
 - Where a BoundEngine engine received and appended columns to donor table and then produced an donor aggregate, the EngineGroup will receive a collection of BoundEngines and produce a similar aggregates object called a 'group aggregate'.
 - Each BoundEngine is associated with a donor table and a donor aggregate. Therefore the EngineGroup implmentation of the def, agg and aggRow functions will work as they currently do on the current BoundEngine donor table and donor aggregate.
- A new GroupEngine versions of the agg and aggRow functions will be added:
 - groupAgg: This aggregates the donor aggregates, it is effectivly like defining an Engine with an agg statement and passing it an array of donor aggregates as a donor table
 - groupAggRow: This implements a per-row aggregate on donor aggregates, it is effectively like defining an Engine with an aggRow statement and passing it an array of donor aggregates as a donor table
  
## EngineGroup analog of RowGet for BoundEngines

The 'EngineGet' implmentation works for the donor BoundEngines as 'rowGet' works for donor tables.
Statements like the 
```js 
?.engine(-1).get(0) //get the first row in the previous BoundEngine donor table
?.engine(1).aggs.an_aggregate //get the an_aggregate property from the next BoundEngine donor aggregate.
```

the RowGet implementation within .def functions of the GroupEngine should work as currently implemented.

## donor BoundEngine — intrinsic row/column metadata

As with donor tables rows BoundEngines also have intrinsic scalar properties of engineIndex and engineCount
  

  Please Note: All examples supplied are javascript pseudocode and as such are untested.