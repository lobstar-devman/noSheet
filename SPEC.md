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