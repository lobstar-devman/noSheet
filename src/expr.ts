/**
 * An expression tree node. Expressions are pure descriptions of a computation
 * over a single table row — they are not evaluated until applyDefinitions() is called.
 *
 * Consumers build expressions using col(), scalar(), and the operator functions
 * (mul, add, sub, div). Expressions are never constructed directly.
 */
export type Expr = ColExpr | ScalarExpr | BinopExpr;

type ColExpr = {
  readonly _tag: "col";
  readonly name: string;
};

type ScalarExpr = {
  readonly _tag: "scalar";
  readonly value: number;
};

type BinopExpr = {
  readonly _tag: "binop";
  readonly op: "*" | "+" | "-" | "/";
  readonly left: Expr;
  readonly right: Expr;
};

/** References a column by name. The value is resolved from the current row at evaluation time. */
export function col(name: string): Expr {
  return { _tag: "col", name };
}

/** A constant numeric value, independent of the row. */
export function scalar(value: number): Expr {
  return { _tag: "scalar", value };
}

/** Multiplies two expressions. */
export function mul(left: Expr, right: Expr): Expr {
  return { _tag: "binop", op: "*", left, right };
}

/** Adds two expressions. */
export function add(left: Expr, right: Expr): Expr {
  return { _tag: "binop", op: "+", left, right };
}

/** Subtracts the right expression from the left. */
export function sub(left: Expr, right: Expr): Expr {
  return { _tag: "binop", op: "-", left, right };
}

/** Divides the left expression by the right. */
export function div(left: Expr, right: Expr): Expr {
  return { _tag: "binop", op: "/", left, right };
}

/**
 * Evaluates an expression against a single row.
 *
 * @throws {Error} if a col() reference names a column not present in the row.
 */
export function evalExpr(expr: Expr, row: Readonly<Record<string, number>>): number {
  switch (expr._tag) {
    case "col": {
      const value = row[expr.name];
      if (value === undefined) {
        throw new Error(`Column "${expr.name}" not found in row.`);
      }
      return value;
    }
    case "scalar":
      return expr.value;
    case "binop": {
      const l = evalExpr(expr.left, row);
      const r = evalExpr(expr.right, row);
      switch (expr.op) {
        case "*":
          return l * r;
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "/":
          return l / r;
      }
    }
  }
}
