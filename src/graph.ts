import type { ComputationNode, ComputationGraph, ComputationResult } from "./types.js";

/**
 * Builds and evaluates a computation graph.
 *
 * Nodes are evaluated in topological order. Cycles are detected at evaluation time.
 */
export class Graph implements ComputationGraph {
  readonly nodes: ReadonlyMap<string, ComputationNode>;

  private constructor(nodes: Map<string, ComputationNode>) {
    this.nodes = nodes;
  }

  static create(): Graph {
    return new Graph(new Map());
  }

  /**
   * Returns a new Graph with the given node added or replaced.
   * Does not mutate the current graph.
   */
  add(node: ComputationNode): Graph {
    const next = new Map(this.nodes);
    next.set(node.id, node);
    return new Graph(next);
  }

  /**
   * Evaluates all nodes in topological order and returns a map of id → value.
   *
   * @throws {Error} if a dependency is missing or a cycle is detected.
   */
  evaluate(): ComputationResult {
    const order = topologicalSort(this.nodes);
    const results = new Map<string, unknown>();

    for (const id of order) {
      const node = this.nodes.get(id);
      // topologicalSort only yields ids present in the map.
      if (node === undefined) continue;

      const inputs: Record<string, unknown> = {};
      for (const dep of node.dependencies) {
        if (!results.has(dep)) {
          throw new Error(`Node "${id}" depends on "${dep}" which has not been evaluated.`);
        }
        inputs[dep] = results.get(dep);
      }
      results.set(id, node.compute(inputs));
    }

    return results;
  }
}

/**
 * Returns node ids in topological (dependency-first) order using Kahn's algorithm.
 *
 * @throws {Error} if a cycle is detected.
 */
function topologicalSort(nodes: ReadonlyMap<string, ComputationNode>): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const [id] of nodes) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const [id, node] of nodes) {
    for (const dep of node.dependencies) {
      if (!nodes.has(dep)) {
        throw new Error(`Node "${id}" has unknown dependency "${dep}".`);
      }
      const depList = dependents.get(dep);
      if (depList !== undefined) depList.push(id);
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (order.length !== nodes.size) {
    throw new Error("Cycle detected in computation graph.");
  }

  return order;
}
