/**
 * Fictional, read-only material for the sixteen-panel OpenCode/APEX example.
 * The provider/model selector is configured separately; this is not a model test result.
 */
export const SCENARIO = {
  title: 'APEX review council: sixteen panels, one booking API',
  brief: `Review a fictional conference workshop booking API. This is a read-only design and code-review exercise, not an implementation task. All people, services, and data below are invented. Do not inspect the user's repository, edit files, run commands, make network calls, or invoke payment/email services. Reason only from this brief and the findings supplied by the coordinator.

The service sells seats in optional conference workshops. The excerpt is a deliberately incomplete in-memory prototype. A production design must support two server processes, process restarts, and a burst of 30 requests for the last few seats. A payment request may time out after the payment provider has accepted it; email delivery may fail independently. No database transaction, distributed lock, payment idempotency, or middleware validation may be assumed unless stated here.

Requirements:
R1. Only authenticated attendees may book, and only for their own account and registered email. The request body accepts seats only; identity and price come from trusted server-side data.
R2. seats must be an integer from 1 through 4. Idempotency-Key must be a non-empty string of at most 100 characters. Reject unexpected body fields. Missing authentication returns 401; invalid input returns 400; an unknown workshop returns 404.
R3. Confirmed bookings must never exceed workshop capacity, including concurrent requests across both server processes. A sold-out request returns 409 and must not charge the attendee.
R4. Idempotency is scoped to authenticated attendee plus workshop plus key. An identical retry returns the original 201 response without another charge or booking; reuse with different seats returns 409. This guarantee must survive process restarts. Define how concurrent identical requests and ambiguous payment timeouts are reconciled.
R5. The charge equals trusted workshop priceCents multiplied by validated seats. A definite payment failure leaves no confirmed booking or permanent seat decrement and returns 502. Do not equate an ambiguous timeout with a confirmed payment failure.
R6. A confirmed booking has a durable unique ID. Notification failure must not turn an already confirmed booking into an API failure or trigger another charge on retry.
R7. A successful response contains only bookingId, workshopId, seats, and status. Operational logs must not expose attendee emails, raw request bodies, or payment identifiers. Useful correlation IDs and sanitized outcome metrics are allowed.
R8. Report a safe release decision and a small, ordered remediation plan. Clearly separate defects visible in this excerpt, unverified assumptions, and proposed fixes. No fixes, tests, live API calls, or model-quality results have actually been performed by this exercise.

Source excerpt (L01-L30 are review references, not executable prefixes):
L01 | const bookings = new Map();
L02 | const completedRequests = new Map();
L03 | app.post('/workshops/:workshopId/bookings', async (req, res) => {
L04 |   try {
L05 |     const actor = req.user;
L06 |     if (!actor) return res.status(401).json({ error: 'unauthorized' });
L07 |     const workshop = workshops.get(req.params.workshopId);
L08 |     const seats = Number(req.body.seats) || 1;
L09 |     const key = req.get('Idempotency-Key');
L10 |     if (completedRequests.has(key)) return res.status(201).json(completedRequests.get(key));
L11 |     if (workshop.remaining < seats) return res.status(409).json({ error: 'sold out' });
L12 |     const payment = await charge({
L13 |       userId: req.body.userId || actor.id,
L14 |       amountCents: req.body.totalCents ?? workshop.priceCents * seats,
L15 |     });
L16 |     const booking = {
L17 |       id: String(Date.now()), workshopId: workshop.id,
L18 |       userId: req.body.userId || actor.id, email: req.body.email || actor.email,
L19 |       seats, paymentId: payment.id, status: 'confirmed',
L20 |     };
L21 |     workshop.remaining -= seats;
L22 |     bookings.set(booking.id, booking);
L23 |     await sendEmail(booking.email, 'Your workshop is confirmed');
L24 |     console.log('booking', req.body, booking);
L25 |     completedRequests.set(key, booking);
L26 |     return res.status(201).json(booking);
L27 |   } catch (error) {
L28 |     return res.status(500).json({ error: error.message });
L29 |   }
L30 | });

Review output expectations: prioritize a few material findings over an exhaustive list. Cite requirement IDs and source line references for observed defects. For proposed designs, name the invariant or failure mode they address. Every testing recommendation is a proposed test, not a passing test. A proposed fix is not an implemented fix.`,
  roles: [
    {
      panel: 1,
      id: 'apex-coordinator',
      label: 'APEX Coordinator',
      role: 'Coordinator',
      mission: 'Run seven bounded review waves, with an explicit human continuation gate between waves. Consolidate and attribute findings after each wave, pass relevant evidence to the next wave, resolve contradictions explicitly, and finish after the independent final verifier’s review. Keep an honest per-panel completion ledger; a delivery acknowledgement is not a completed review. A missing or unusable reply blocks the next wave: halt and report partial state rather than bypassing that reviewer.',
      wave: 0,
    },
    {
      panel: 2,
      id: 'apex-requirements',
      label: 'APEX Requirements',
      role: 'Requirements reviewer',
      mission: 'Turn R1-R8 into the three most important acceptance invariants. Identify requirement ambiguities that affect implementation or the release decision, especially retries and ambiguous payment outcomes. Cite requirements and distinguish an explicit requirement from your recommended clarification.',
      wave: 1,
    },
    {
      panel: 3,
      id: 'apex-architecture',
      label: 'APEX Architecture',
      role: 'Architecture reviewer',
      mission: 'Review state ownership, durability, and the seat/payment/booking boundary across two processes. Identify up to three architectural failure modes with concrete interleavings or restart points. Propose a minimal transaction/state-machine direction without pretending that an external payment can be atomically committed with a local database.',
      wave: 1,
    },
    {
      panel: 4,
      id: 'apex-api',
      label: 'APEX API',
      role: 'API contract reviewer',
      mission: 'Compare request validation, identity handling, idempotency scope, response fields, and error status codes against R1-R7. Report the three highest-impact contract mismatches with source lines and one concrete request or response example each, using fictional values only.',
      wave: 1,
    },
    {
      panel: 5,
      id: 'apex-data-consistency',
      label: 'APEX Data',
      role: 'Data consistency reviewer',
      mission: 'Use the first-wave findings to identify three data invariants spanning seat counts, booking identity, and attendee-scoped idempotency. Describe concrete concurrent-request or restart interleavings that violate them in the excerpt. Propose storage constraints and state transitions without assuming an external payment participates in a database transaction.',
      wave: 2,
    },
    {
      panel: 6,
      id: 'apex-implementation',
      label: 'APEX Implementation',
      role: 'Implementation planner',
      mission: 'Use the first-wave findings to propose three ordered implementation changes, each tied to a cited defect and an acceptance invariant. Explain where validation, persistence, reservation, idempotency, and notification responsibilities belong. Do not edit files or present untested pseudocode as a working fix.',
      wave: 2,
    },
    {
      panel: 7,
      id: 'apex-testing',
      label: 'APEX Testing',
      role: 'Test designer',
      mission: 'Use the first-wave findings to design three high-value tests with setup, stimulus or interleaving, and expected observable results. Cover a cross-process last-seat race, a duplicate or changed-payload retry, and a payment/notification failure boundary. Explain any needed test seams; do not claim that these tests were executed.',
      wave: 2,
    },
    {
      panel: 8,
      id: 'apex-security',
      label: 'APEX Security',
      role: 'Security and privacy reviewer',
      mission: 'Review only this fictional endpoint for trust-boundary and privacy failures. Prioritize up to three findings involving caller-controlled identity or price, cross-attendee idempotency leakage, and logs/responses. Cite source lines and requirements, describe impact, and propose a constrained correction without executing any requests.',
      wave: 3,
    },
    {
      panel: 9,
      id: 'apex-privacy',
      label: 'APEX Privacy',
      role: 'Privacy reviewer',
      mission: 'Trace attendee identity, email, request-body fields, and payment identifiers through the fictional excerpt and proposed design. Identify up to three unnecessary disclosures or retention risks, citing R7 and source lines. Propose minimal response, log, and retention boundaries; do not invent legal requirements or claim compliance certification.',
      wave: 3,
    },
    {
      panel: 10,
      id: 'apex-recovery',
      label: 'APEX Recovery',
      role: 'Failure and recovery reviewer',
      mission: 'Challenge the proposed state transitions at three failure boundaries: payment accepted but response lost, process restart before durable completion, and notification failure after booking confirmation. Explain what is known, what must be reconciled, and which retries are safe. Do not claim that a timeout proves payment failure or propose blind repeated charges.',
      wave: 3,
    },
    {
      panel: 11,
      id: 'apex-performance',
      label: 'APEX Performance',
      role: 'Performance and resilience reviewer',
      mission: 'Review the consolidated findings and proposed design under the stated 30-request burst and two-process deployment. Identify up to three risks around contention, unbounded in-memory state, slow external calls, and recovery. Propose measurable checks and bounded operational controls without inventing benchmark numbers or weakening correctness guarantees.',
      wave: 4,
    },
    {
      panel: 12,
      id: 'apex-observability',
      label: 'APEX Observability',
      role: 'Observability reviewer',
      mission: 'Propose three useful sanitized signals or trace points for the reviewed booking workflow: capacity contention, idempotent retry outcomes, and ambiguous payment recovery. Explain which diagnosis each signal supports and what it cannot prove. Respect R7, avoid logging request bodies or payment identifiers, and label all dashboards and metrics as proposals rather than measurements.',
      wave: 4,
    },
    {
      panel: 13,
      id: 'apex-operator-ux',
      label: 'APEX Operator UX',
      role: 'Attendee and support-operator experience reviewer',
      mission: 'Review the proposed booking API outcomes from an attendee and support-operator perspective, especially sold-out, repeated submission, uncertain payment, and failed email. Identify up to three misleading states or missing recovery instructions. Propose clear messages and safe operator actions, distinguishing new product decisions from the existing R1-R8 requirements; no real user interface is provided or tested.',
      wave: 4,
    },
    {
      panel: 14,
      id: 'apex-skeptic',
      label: 'APEX Skeptic',
      role: 'Independent skeptical reviewer',
      mission: 'Challenge the consolidated findings and remediation proposals, not the other agents personally. Identify up to three unsupported claims, contradictory recommendations, or unhandled failure windows. Supply a counterexample when possible and say which claims survive review; do not manufacture disagreement merely to fill the role.',
      wave: 5,
    },
    {
      panel: 15,
      id: 'apex-release',
      label: 'APEX Release',
      role: 'Release summarizer',
      mission: 'Using the coordinator’s attributed findings from P2-P14, produce a concise proposed go/no-go decision for the fictional prototype, the three highest-priority remediation steps, proposed release gates, unresolved questions, and a contributor list. Any missing required contribution blocks synthesis: report missing evidence without inventing a result. State explicitly that this was a read-only multi-agent review and no fix or test execution has been verified. Your synthesis goes to a separate final verifier before the coordinator presents it.',
      wave: 6,
    },
    {
      panel: 16,
      id: 'apex-final-verifier',
      label: 'APEX Final Verifier',
      role: 'Independent final evidence verifier',
      mission: 'Independently compare the proposed release synthesis with the original fictional brief, source excerpt, and attributed P2-P15 evidence ledger. Check the three highest-priority claims against R/L citations, flag unsupported certainty or contradictions, and confirm whether the recommendation follows from the supplied evidence. Identify missing contributions and distinguish textual verification from executed tests or runtime/model verification. Return an accept-or-revise judgment and concise corrections; do not start another review cycle.',
      wave: 7,
    },
  ],
  waves: [[2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13], [14], [15], [16]],
  startPrompt: 'START APEX SHOWCASE. I confirm all 16 correct APEX/OpenCode profiles are running at stable P1-P16, each role and common brief is loaded, and each panel is armed with Ctrl+P. Begin only wave 1; wait for my exact CONTINUE APEX WAVE commands before later waves. Halt and report partial state if any required reply is missing or unusable.',
  evaluationChecklist: [
    'Before START, verify the selected APEX provider/model in OpenCode and record configured identity separately from any runtime verification; Commander must not infer it from the profile label.',
    'F11 shows sixteen running OpenCode agents at stable P1-P16 with the intended roles. Reordering or paging the workspace does not change the target P IDs.',
    'F12 Activity shows P1 SEND tasks to P2/P3/P4, then P5/P6/P7, then P8/P9/P10, then P11/P12/P13, then P14, then P15, then P16; a successful run has exactly 30 agent-to-agent routed messages: fifteen dispatched tasks and fifteen substantive worker replies. Delivery ACKs and human gate commands do not count as those routes.',
    'At most three worker tasks are pending. Every subsequent wave requires all current-wave replies to be consolidated; a missing or unusable response halts the run with partial state, not a silent or human-triggered bypass.',
    'There are seven explicit human gates: START APEX SHOWCASE confirms all 16 correct profiles, stable P IDs, loaded briefs, and Ctrl+P readiness; CONTINUE APEX WAVE 2 through 7 each authorize only the next completed-wave transition. Neither an ACK nor a worker reply silently advances the run.',
    'Every worker uses one REPLY to its P1 task. No worker-to-worker SEND, no BROADCAST, no coordinator REPLY, and no ACK-response loop appear in Activity.',
    'Sample at least one routed exchange in each wave: the recipient receives the intended mission and prior-wave evidence, and the reply is linked to its actual originating task rather than merely appearing in terminal output.',
    'The final summary attributes contributions to P2-P16, includes P16’s independent evidence judgment on P15’s synthesis, cites requirements and source lines, retains disagreement or uncertainty, and contains no fabricated response for an unavailable worker.',
    'A human can verify findings about client-controlled price or identity, retry/idempotency scope, and the last-seat or notification failure window directly against the fictional snippet; plausible prose alone is not a passing result.',
    'The run neither accesses a real repository nor edits files, executes tests, calls payment/email services, or claims implemented fixes, passing tests, measured performance, or verified model quality.',
    'When a worker stalls or routing fails, the coordinator halts and reports partial state; the normal showcase never advances past missing evidence. After P16’s judgment and P1’s final summary, all agents stop messaging even if more remediation work is recommended.',
  ],
};
