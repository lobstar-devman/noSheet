export { Engine } from "./engine.js";
export type { TableToRow, RowToTable } from "./engine.js";

// Row and ExprFn remain public for consumers who use applyDefinitions directly.
export type { Row, ExprFn } from "./expr.js";
export type { Definition } from "./definition.js";
export { def } from "./definition.js";
export type { Table } from "./table.js";
export { applyDefinitions } from "./table.js";
