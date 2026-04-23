import { Graph } from "./graph.js";

describe("Graph", () => {
  it("evaluates a single node with no dependencies", () => {
    const graph = Graph.create().add({
      id: "a",
      dependencies: [],
      compute: () => 42,
    });

    const result = graph.evaluate();
    expect(result.get("a")).toBe(42);
  });

  it("evaluates nodes in dependency order", () => {
    const graph = Graph.create()
      .add({ id: "x", dependencies: [], compute: () => 10 })
      .add({ id: "y", dependencies: [], compute: () => 5 })
      .add({
        id: "z",
        dependencies: ["x", "y"],
        compute: (inputs) => (inputs["x"] as number) + (inputs["y"] as number),
      });

    const result = graph.evaluate();
    expect(result.get("z")).toBe(15);
  });

  it("passes resolved dependency values to compute", () => {
    const graph = Graph.create()
      .add({ id: "base", dependencies: [], compute: () => 3 })
      .add({
        id: "doubled",
        dependencies: ["base"],
        compute: (inputs) => (inputs["base"] as number) * 2,
      })
      .add({
        id: "tripled",
        dependencies: ["doubled"],
        compute: (inputs) => (inputs["doubled"] as number) * 1.5,
      });

    const result = graph.evaluate();
    expect(result.get("doubled")).toBe(6);
    expect(result.get("tripled")).toBe(9);
  });

  it("throws on an unknown dependency", () => {
    const graph = Graph.create().add({
      id: "a",
      dependencies: ["missing"],
      compute: () => null,
    });

    expect(() => graph.evaluate()).toThrow('unknown dependency "missing"');
  });

  it("throws on a cycle", () => {
    const graph = Graph.create()
      .add({ id: "a", dependencies: ["b"], compute: () => null })
      .add({ id: "b", dependencies: ["a"], compute: () => null });

    expect(() => graph.evaluate()).toThrow("Cycle detected");
  });

  it("is immutable — add returns a new graph", () => {
    const g1 = Graph.create().add({ id: "a", dependencies: [], compute: () => 1 });
    const g2 = g1.add({ id: "b", dependencies: [], compute: () => 2 });

    expect(g1.nodes.has("b")).toBe(false);
    expect(g2.nodes.has("b")).toBe(true);
  });
});
