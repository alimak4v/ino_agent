# Render Blocks

Typed render blocks are optional fenced Markdown blocks. They keep the global system prompt small: the model should see this contract only when the context builder decides a rich visual representation is useful.

Supported MVP block types:

```matrix
{"title":"A","rows":[[1,2],[3,4]],"rowLabels":["r1","r2"],"columnLabels":["c1","c2"],"activeRow":0,"activeColumn":1,"highlightCells":[[0,1]]}
```

```vector
{"title":"b","values":[2,4,7],"labels":["k=1","k=2","k=3"],"orientation":"column","activeIndex":2}
```

```chart
{"title":"Loss by iteration","type":"line","xLabel":"iteration","yLabel":"loss","activeIndex":2,"series":[{"label":"train","points":[[1,1.0],[2,0.42],[3,0.28],[4,0.21]]}]}
```

```table
{"columns":["Term","Meaning"],"rows":[["RAG","Retrieval-augmented generation"]]}
```

```proof
{"title":"Claim","steps":[{"claim":"...","reason":"..."},{"expression":"a=b","reason":"..."}]}
```

```source_list
{"sources":[{"title":"...", "target":"notes/file.md#chunk=2", "quote":"...", "score":0.91}]}
```

```step_example
{"title":"Matrix product cell","activeStep":1,"steps":[{"label":"1","expression":"2*2","explanation":"row 1 times column 2"},{"label":"2","expression":"1*4"},{"label":"3","expression":"3*7","result":"29"}]}
```

Rules:
- Use normal Markdown by default.
- Use a render block only when structure improves readability.
- Keep block JSON small and factual.
- Do not duplicate the same content in prose and in the block.
- Prefer `matrix`, `vector`, and `step_example` for worked examples with highlighted rows, columns, cells, or current calculation steps.
- Prefer `chart` for compact numeric trends such as loss curves, convergence, scores by step, or comparison bars.
