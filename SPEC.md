## Library Specification

This library is a mathematical expression engine that works on tabular data.

| cost     | quantity |
| -------- | -------  |
| 3        | 2        |
| 7        | 3        |
| 8        | 4        |

Expressions are applied to each row sequentially and use words as operands, operands corresond to columns in the table, for example: 
net = cost * quantity;

The variable names of expression results can be used as operands in expressions that are syntactically described later in the source code, for example, building on the previous statements:
vat = 1.2;
total = net * vat;

The results of any expressions applied to the table are stored in the table itself, for example, applying the previous expressions would change the table to look like this:

| cost     | quantity | net | total |
| -------- | -------  | --- | ----- |
| 3        | 2        | 6   | 7.2   |
| 7        | 3        | 21  | 25.2  |
| 8        | 4        | 32  | 38.4  |

# Expressions

Expressions are defined as arrow functions.
The Row type contains a definition for all the columns in the table defined so far.
```tyepscript
(row: Row) => row.cost * row.quantity;
```

The `Row` type is continuously updated with the column names that are created by expressions.

The `Row` type should work with VSCode TypeScript code completion. So that after a new expression is defined - that column name should be available on the row type when typing the new expression code into the IDE.

Expressions which use columns that have defined by expressions that have not yet had thier results calculated should not be allowed, for instance, definining the expressions below in syntactic order should not be possible:

result2 = result1 + 3;
result1 = 1 + 2;

Operands and expression results can be numbers, strings, bigints or booleans. 