---
title: Fixture plan
status: review
---

# Fixture plan

## Heading with `code` and **bold**

Start writing to it **early, without a gate**, so history has _depth_ from day one.
See [the docs](https://example.com) and `web/src/Foo.tsx:42` for details.

Tom &amp; Jerry use \*literal stars\* and a pipe.

| Column A | Column **B** |
|---|---|
| cell one | cell `two` \| piped |

- top item
  - nested item with **bold**
    continued line
- [ ] task not done
- [x] task done

> quoted line one
> quoted **line** two

```ts
const answer = 42
console.log(answer)
```

- a list item holding code:

  ```sh
  pnpm test --run
  ```

Final paragraph one ends here.

Final paragraph two starts here.

```question id=store
Where should sessions live?
- In memory (recommended)
  Fast, but lost on restart.
- On disk
---
### Context
Sessions are read in `server/src/sessions.ts:12` on every **request**.

### Recommendation
Keep them in memory; revisit if restarts hurt.
```
