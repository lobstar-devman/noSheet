# EngineGroup spec

## The Role of The Engine Group

The EngineGroup's role is to process the output of a collection of BoundEngines that share the same Engine constructor.

The current role of a BoundEngine is to append data to the supplied table object or array and to generate a aggregate object.

The new EngineGroup will work in exactly the same way, with the important following distinctions:
1. Where a BoundEngine engine received and append to a table object or array and then produced an aggregate object, the EngineGroup will receive a collection of BoundEngines and product an aggregate object.
2. Each BoundEngine has an underlying table object or array