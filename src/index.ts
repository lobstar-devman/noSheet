export { Engine, BoundEngine } from "./engine.js";
export type { TableToRow } from "./engine.js";

// Row, ExprFn, AggFn, AggRowFn remain public for consumers who use applyDefinitions directly.
export type { Row, ExprFn, AggFn, AggRowFn } from "./expr.js";
export type { Definition } from "./definition.js";
export { def } from "./definition.js";
export type { Table } from "./table.js";
export { applyDefinitions } from "./table.js";
