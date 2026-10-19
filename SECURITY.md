# Omacelium — Security Scope: prompt confidentiality

Status: scoping. Requirement from the user, 2026-10-19:

> No other nodes should see prompts of other mesh participants.

This document states what that means for this plugin, what Mesh-LLM can and
cannot guarantee, and the decisions needed before M0.

## 1. The architecture fact that decides everything

Mesh-LLM routes an inference request by its `model` field to the node that
serves that model. That node runs the model, so **the prompt is in its memory
for the duration of the request, and the serving operator can read it**. There
is no confidential-computing path (no TEE, no attested enclave) and upstream
explicitly says release attestation proves provenance and admission, *not*
hardware/OS integrity (`mesh/docs/design/NODE_OWNER_IDENTITY.md`).

What encryption does cover:
- QUIC end-to-end encryption between nodes, including inference requests,
  responses, and split-model activations; iroh relays forward ciphertext and
  cannot read payloads.
- Owner attestation: a peer can prove which owner operates it (`owner_id`), so a
  trust list can restrict *who* is in the mesh.
- Telemetry is metrics-only and opt-in; the contract forbids exporting prompts,
  completions, logs, traces, hostnames, endpoints, paths, or prompt hashes.
- Local request logging excludes prompts, completions, credentials, URLs, and
  free-form payloads by design (`mesh/docs/CLI.md`).

So the requirement is **not** satisfiable for cross-node inference in a
community mesh, in either direction:

- If *your* prompt is routed to someone else's node, that operator can read it.
- If *you* serve a model, you will see the prompts of peers you serve.

Both directions are enforceable only by restricting the mesh to nodes you
trust. That is the whole security design space.

## 2. Who can see a prompt

| Actor | Sees prompt content? | Can it be prevented? |
|---|---|---|
| Serving node (operator + local root) | Yes, in memory while serving | Only by not routing there: local-only or trusted-owners-only |
| Downstream split stages | Not the prompt text, but activations derived from it; inversion is research-grade but non-zero | Disable `--split` in private mode (default) |
| Routing/relay nodes, iroh relays | No — ciphertext only | Already guaranteed by upstream |
| Other mesh members not serving the request | No | Already guaranteed |
| Nostr discovery / public gossip | No prompt content; leaks node/model presence | Private mode: no publish, invite token + LAN/mDNS discovery |
| Your own node's logs/ledger | No prompt content (upstream excludes it) | Verified by test T-4 |
| Telemetry collector | No prompt content | Already guaranteed by upstream contract |
| Malicious peer that lies about its model or tampering | Yes, if it serves your request | Only by trust list + owner attestation of people you accept |

## 3. Modes and whether they satisfy the requirement

| Mode | Prompts served where | Meets the requirement |
|---|---|---|
| Local-only (`--local-model-only`, model fits) | Your machine | ✓ |
| Private mesh, trusted owners only (`--join <token>`, `--trust-owner`, no `--publish`, mDNS/introducer discovery) | Your machines plus owners you explicitly trust | ✓ |
| Community mesh (`--auto`, public discovery) | Any peer advertising the model | — |
| Client-only (`--client`) | Peers you route to; you never see others' prompts | ✓ for "I don't serve others", — for "others don't see mine" |
| `--split` staged model across peers | Multiple peers hold activations | — (default off in private mode) |
| `--publish` mesh | Same as community, plus discovery exposure | — |

Trust caveat, to be stated in the UI and README: a trusted *owner* is a
trust decision, not a technical guarantee. Trust is by people/keys, so a
compromised trusted machine breaks confidentiality. There is no per-prompt
proof that a peer did not retain the prompt beyond its own logging discipline.

## 4. Proposed product policy

1. **Default mode: Private (my devices + owners I trust).** Public discovery off,
   no `--publish`, invite token or mDNS, explicit trust list, splits disabled.
   This is the only default that meets the requirement out of the box.
2. **Community mode is opt-in with a consent screen** that says, in plain words:
   your prompts are processed by peers you do not control, and as a serving node
   you will process other people's prompts. Do not present community mode as
   private.
3. **Serving scope control**: separate switch for "serve peers" vs "use the mesh
   only". Client-only is the honest answer for an operator who does not want to
   see other participants' prompts.
4. **Per-request transparency**: the panel shows whether the last request was
   served locally or by a peer, and if by a peer, which owner id. (Bind only to
   fields confirmed in M0's `/api/status` capture.)
5. **No prompt retention by this plugin.** The plugin never writes prompt
   content to state, logs, or the panel. Inherit upstream's exclusion and prove
   it with test T-4.
6. **Metadata hygiene in private mode**: no Nostr publish, no tray badge that
   leaks model names beyond the local panel, invite tokens stored 0600 and never
   logged.
7. **Future**: upstream confidential-computing support is the only route to a
   real technical guarantee for community meshes. Track it; do not fake it.

## 5. Verification gates and tests

Gates to confirm on real nodes before M2 ships (M0 captures the facts):

- **G4** Does `--trust-policy`/`--trust-owner` restrict *inbound request
  acceptance*, *outbound routing*, or only gossip? Test with two nodes: an
  untrusted node must not be able to get its request served by ours, and ours
  must not route to it. If trust is not enforced on the request path, private
  mode rests on invites alone — document that honestly and consider refusing to
  serve when the peer's owner is unknown.
- **G5** Does a serving node expose "who requested" / "served by" fields in
  `/api/status` or `/api/runtime/processes`? Needed for item 4, otherwise the
  panel says only "served by a peer".
- **G6** Does `--mesh-discovery-mode mdns` fully avoid public relays, and what
  does the invite token leak if it is reused across machines?

Tests:

- **T-4 (log hygiene)**: run one request containing a unique canary string, then
  `rg` the plugin state dir, `~/.mesh-llm`, and the runtime log store. Zero
  matches required.
- **T-5 (private-mode isolation)**: in private mode, a second node without the
  invite/trust cannot join, cannot fetch `/v1/models`, and cannot get a request
  served.
- **T-6 (community honesty)**: in community mode the panel and README state the
  exposure; a request routed to a peer is labelled as peer-served.
- **T-7 (split policy)**: private mode refuses `--split` unless the user
  explicitly enables it with a warning naming the activation exposure.

## 6. Residual risk accepted (with community mode on)

- A serving peer can retain a prompt; there is no technical enforcement.
- Free-riding and unknown peers are possible (AGENTS.md accepts no gating).
- Public discovery leaks that you host certain models.
- Model-license exposure is separate from prompt confidentiality.

The plugin's job is to make the boundary explicit, default to the safe mode, and
never claim a guarantee it cannot back.

## 7. Decisions needed from the user

1. Which requirement is meant: *others must not see my prompts*, *I must not see
   others' prompts*, or both? (Private mode covers both; client-only covers the
   second. Community mode covers neither.)
2. Should community mode ship at all in v1, or be deferred until upstream offers
   confidential compute?
3. Default for a first run: private/trusted mesh, or local-only until the user
   opts in to any mesh?

Recommended, pending confirmation:

1. Both directions.
2. Defer community mode; do not advertise confidentiality there.
3. Local-only on first run; the panel offers "Set up private mesh" and
   "Join community mesh (warns: peers can read prompts you send, and you will
   process theirs)".
