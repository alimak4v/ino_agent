# Render Blocks

Typed render blocks are optional fenced Markdown blocks. They keep the global system prompt small: the model should see this contract only when the context builder decides a rich visual representation is useful.

Supported MVP block types:

```matrix
{"title":"A","rows":[[1,2],[3,4]],"rowLabels":["r1","r2"],"columnLabels":["c1","c2"]}
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

Rules:
- Use normal Markdown by default.
- Use a render block only when structure improves readability.
- Keep block JSON small and factual.
- Do not duplicate the same content in prose and in the block.
