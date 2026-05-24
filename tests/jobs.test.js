import { test, expect } from "bun:test"
import { makeHandler } from "../src/engine/server.js"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "../libraries")
const C = value => ({ type: "const", value })
const nil = { type: "compound", functor: "nil", args: [] }
const cons = (h, t) => ({ type: "compound", functor: "cons", args: [h, t] })

const firstofRequest = {
  problem: {
    bias: {
      head_predicates: [{ name: "firstof", arity: 2, mode: ["in", "out"] }],
      body_predicates: [{ name: "head", arity: 2 }],
      max_clauses: 1, max_body_length: 1, max_variables: 2, max_recursion_depth: 1, allow_recursion: false
    },
    positives: [{ predicate: "firstof", args: [cons(C(1), nil), C(1)] }],
    negatives: [{ predicate: "firstof", args: [cons(C(1), nil), C(2)] }]
  },
  library: "lists@1.0.0",
  budget: { max_time_ms: 5000, max_candidates: 2000, target_coverage: 1.0 },
  targets: ["javascript"]
}

const postAsync = (handle, body, headers = {}) =>
  handle(new Request("http://t/v1/synthesize", { method: "POST", body: JSON.stringify(body), headers }))

async function poll(handle, id, tries = 300) {
  for (let i = 0; i < tries; i++) {
    const body = await (await handle(new Request(`http://t/v1/jobs/${id}`))).json()
    if (body.status !== "pending") return body
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error("job never completed")
}

// Read an SSE response into a list of { event, data } until a terminating event or end.
async function readSSE(response, terminators = ["complete", "error"]) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const events = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let i
    while ((i = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, i); buffer = buffer.slice(i + 2)
      const event = (block.match(/^event: (.*)$/m) ?? [])[1]
      const dataLine = (block.match(/^data: (.*)$/m) ?? [])[1]
      events.push({ event, data: dataLine ? JSON.parse(dataLine) : null })
    }
    if (events.some(e => terminators.includes(e.event))) break
  }
  return events
}

test("async is the default: submit returns a job id, polling yields the result", async () => {
  const handle = makeHandler({ registryRoot: root })
  const res = await postAsync(handle, firstofRequest)
  expect(res.status).toBe(202)
  const body = await res.json()
  expect(body.status).toBe("pending")
  expect(typeof body.job_id).toBe("string")
  expect(body.status_url).toBe(`/v1/jobs/${body.job_id}`)

  const final = await poll(handle, body.job_id)
  expect(final.status).toBe("complete")
  expect(final.solution.program.clauses[0].head.predicate).toBe("firstof")
  expect(final.solution.lowerings.javascript.feasibility).toBe("ok")
})

test("Prefer: respond-sync falls back to a job id when it can't finish in time", async () => {
  // syncTimeoutMs 0: never wait, always fall back — then the job is still pollable.
  const handle = makeHandler({ registryRoot: root, syncTimeoutMs: 0 })
  const res = await postAsync(handle, firstofRequest, { prefer: "respond-sync" })
  expect(res.status).toBe(202)
  const body = await res.json()
  expect(body.status).toBe("pending")
  const final = await poll(handle, body.job_id)
  expect(final.status).toBe("complete")
})

test("Prefer: respond-sync returns the solution inline when it finishes in time", async () => {
  const handle = makeHandler({ registryRoot: root }) // default 5s window; firstof is instant
  const res = await postAsync(handle, firstofRequest, { prefer: "respond-sync" })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.status).toBe("complete")
  expect(body.solution.program.clauses[0].head.predicate).toBe("firstof")
})

test("polling an unknown job is a 404", async () => {
  const handle = makeHandler({ registryRoot: root })
  expect((await handle(new Request("http://t/v1/jobs/does-not-exist"))).status).toBe(404)
})

test("the stream emits best-so-far partials and a final complete event", async () => {
  const handle = makeHandler({ registryRoot: root })
  const { job_id } = await (await postAsync(handle, firstofRequest)).json()
  const stream = await handle(new Request(`http://t/v1/jobs/${job_id}/stream`))
  expect(stream.headers.get("content-type")).toBe("text/event-stream")

  const events = await readSSE(stream)
  expect(events.some(e => e.event === "partial")).toBe(true)
  const complete = events.find(e => e.event === "complete")
  expect(complete).toBeDefined()
  expect(complete.data.program.clauses[0].head.predicate).toBe("firstof")
})

test("the stream survives a client that hangs up early; the job still completes", async () => {
  const handle = makeHandler({ registryRoot: root })
  const { job_id } = await (await postAsync(handle, firstofRequest)).json()
  const stream = await handle(new Request(`http://t/v1/jobs/${job_id}/stream`))
  const reader = stream.body.getReader()
  await reader.read()      // take one chunk
  await reader.cancel()    // hang up early — must not throw or wedge the job

  const final = await poll(handle, job_id)
  expect(final.status).toBe("complete")
})
