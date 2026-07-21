# Linear Algebra Mini Lecture

## Matrix Multiplication

Matrix multiplication combines rows from the left matrix with columns from the right matrix. For
matrices `A` and `B`, each output cell is:

```text
C[i,j] = sum over k of A[i,k] * B[k,j]
```

The operation is associative, so `(AB)C = A(BC)`, but it is not generally commutative, so `AB` and
`BA` can be different or one of them can be undefined.

## Vectors and Basis

A vector can be represented as coordinates relative to a basis. Changing the basis changes the
coordinate description, not the underlying geometric vector. Standard basis vectors in two dimensions
are usually `e1 = [1, 0]` and `e2 = [0, 1]`.

## Eigenvectors

An eigenvector of a linear transformation keeps its direction after the transformation. If `A v = lambda v`,
then `v` is an eigenvector and `lambda` is the eigenvalue. Eigenvectors are useful for understanding
stable directions, repeated transformations, and principal components.

## Study Prompt

Ask ino-agent:

```text
Explain matrix multiplication using a matrix block, a vector block, a small chart, and a Mermaid flowchart.
Then give me a two-question quiz.
```
