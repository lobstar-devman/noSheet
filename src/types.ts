/**
 * A single node in a computation graph.
 *
 * @typeParam T - The value type this node produces.
 */
export interface ComputationNode<T = unknown> {
  /** Unique identifier within the graph. */
  readonly id: string;
  /** Ids of nodes whose output this node depends on. */
  readonly dependencies: readonly string[];
  /** Pure function that computes this node's value from its dependencies' resolved values. */
  readonly compute: (inputs: Record<string, unknown>) => T;
}

/**
 * A directed acyclic graph of computation nodes.
 */
export interface ComputationGraph {
  readonly nodes: ReadonlyMap<string, ComputationNode>;
}

/**
 * The resolved output of evaluating a graph.
 * Maps each node id to its computed value.
 */
export type ComputationResult = ReadonlyMap<string, unknown>;
