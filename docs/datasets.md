# Commander Protocol datasets for LoRA / SFT

This source checkout supports opt-in semantic capture and offline, reviewed
dataset creation. It does **not** start recording by default, upload data,
download models, or run training. These commands are not in public npm 0.1.4.
The [design plan](session-capture-plan.md) records the broader roadmap.
`dataset` is now a reserved CLI subcommand. To open a workspace literally named
`dataset`, use `./dataset` or its absolute path.

## 1. Record a permissioned session

Use Node.js 22+ and build this checkout:

```bash
npm run build
npm start -- --capture protocol --capture-project project-01 /path/to/project
```

`project-01` is an opaque project-family identifier, not a path or client name.
Reuse it for related runs, branches and tasks. Different labels for the same
project can cause train/test leakage that automatic similarity checks miss.

Captures are local, private directories under
`~/.agents-commander/captures/capture-<uuid>/`. The CLI prints the destination;
the status bar prioritizes `REC:PROTOCOL`, `REC:METADATA` or `REC:INCOMPLETE`.
An explicit `--capture-dir /outside/the/project` changes the private root.
Symlink paths are rejected. `--capture metadata` records no message bodies and
cannot produce content-training examples. Consent is not saved to config.
The effective default path is checked too: if the working directory contains
the default recording root (for example, your home directory), choose an
explicit external `--capture-dir`.

For usable candidate context:

1. Launch the required agents and press **Ctrl+P** in each to arm the protocol.
2. Submit the initial task through **Ctrl+O** or a Commander template.
3. Let agents use SEND, REPLY, BROADCAST, STATUS and QUERY normally.
4. Exit with **F10** so routing settles and the capture can be sealed.

Raw keyboard input is **not recorded**. It marks that session's context as
incomplete for gold-data selection; restart the agent session before collecting
new eligible examples. This includes manually pasted tasks. Commander observes
only its own communication layer, not provider prompts, hidden reasoning,
internal tool calls or full model context.

Known capability literals and common credential patterns are redacted before
persistence. This is best-effort filtering, **not a privacy guarantee**. Source
code, personal data and unexpected secrets can remain. Review the material and
its usage permissions before export. File permissions are not encryption.

## 2. Inspect and prepare review candidates

```bash
npm start -- dataset inspect /path/to/capture-uuid
npm start -- dataset prepare /path/to/capture-uuid --out ~/commander-review-01
```

`prepare` also accepts multiple capture directories. The output parent must
already exist; the output directory must be new. Existing files are never
overwritten. Incomplete, tampered or metadata-only captures cannot become gold
data. The first implementation rejects damaged captures rather than trying to
repair them into training material.

A close warning during the final directory-sync acknowledgement can occur after
valid, fully written segments and an atomic manifest commit. In that narrow
case, the strict on-disk inspector determines integrity; any missing, unsealed
or damaged file is still rejected.

The private review bundle includes `candidates.jsonl`, `review.json`, a manifest,
JSON Schemas and guidance. Candidate records contain source-event references,
the focal agent, capability bindings and coverage. An accepted emission creates
at most one candidate: broadcast fan-out does not multiply assistant responses.
Transport success is not a quality label.

Initial safety limits are explicit: recorder content is at most 512 KiB before
redaction, serialized events at most 1 MiB, pending writes 4 MiB, segments 16 MiB,
and each run 256 MiB / 100,000 events. Dataset preparation is deliberately smaller:
at most 64 captures, 64 MiB / 20,000 source events and 2,000 candidates per batch;
context is bounded to 256 KiB / 128 messages and completion bodies to 32 KiB.
Limit failures do not silently truncate a gold example. Large collections must
be curated into appropriately grouped, reviewed batches.

## 3. Review deliberately

Inspect each candidate and edit its corresponding decision in `review.json`.
Keep candidate IDs, content hashes and the manifest hash unchanged. Approve
only examples that meet every gate:

| Field | Reviewer confirms |
| --- | --- |
| `quality` | Correct protocol usage and a useful task response |
| `context` | Enough observed context for this next response; no hidden assumptions |
| `privacy` | Content is suitable for the intended training environment |
| `rights` | Permission to use the underlying code, prompts and outputs for training |
| `approved` | Explicit inclusion after the other checks |

All five fields start `false`. Approved decisions also need a nonempty reviewer
identifier and an ISO timestamp in `reviewedAt`. Notes and reviewer identity are
private provenance, not model input. Do not bulk-approve real data without
review. Edited candidate content invalidates the original hash binding.

## 4. Export and validate

```bash
npm start -- dataset export ~/commander-review-01 --out ~/commander-dataset-01 --seed experiment-01
npm start -- dataset validate ~/commander-dataset-01
```

Use a non-secret seed and preserve it with the manifests. Export replaces
symbolic capabilities with deterministic, format-valid **synthetic** keys. Keys
are distinct per example, session and rotation, and are never derived from live
capabilities. The corresponding prompt, header and footer use the same binding.

The dataset contains real `train.jsonl`, `validation.jsonl` and `test.jsonl`,
separate `synthetic.*.jsonl` files, provenance sidecars, hashes, split assignments,
schemas and training guidance. Synthetic fixtures are never silently combined
with real-agent examples. Store the whole bundle privately; share training rows
only after a separate sharing decision.

Whole project families and detected near-duplicate groups stay in one split.
With fewer than three independent groups, all examples stay in train and the
held-out files are empty. This is honest pilot data, not evidence of generalization.
The bounded similarity heuristic cannot detect every paraphrase. Freeze a
complete exported bundle for an experiment; adding sources can change splits.

## Training-row contract

Each line has **only** `prompt` and `completion`. The completion is one focal
agent's next assistant response. Peer messages and Commander feedback are
labelled user-context messages, not trusted system messages or invented native
tool calls. Earlier focal-agent frames may appear as assistant context.

```json
{"prompt":[{"role":"user","content":"Use Commander Protocol. Current synthetic session key: SYNTHETIC_KEY_FOR_TRAINING_ONLY_0000000000000. Report progress on the requested review."}],"completion":[{"role":"assistant","content":"===COMMANDER:STATUS:SYNTHETIC_KEY_FOR_TRAINING_ONLY_0000000000000===\nReviewing the requested module.\n===COMMANDER:END:SYNTHETIC_KEY_FOR_TRAINING_ONLY_0000000000000==="}]}
```

This is the conversational prompt/completion format supported by
[TRL SFTTrainer](https://huggingface.co/docs/trl/sft_trainer). It keeps loss on
the target response separate from context and audit metadata. The example above
is illustrative synthetic data, not a captured agent response.

Recommended starting configuration for a separately approved LoRA experiment:

```python
# Supply a chosen, revision-pinned compatible base model and tokenizer separately.
from datasets import load_dataset
from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

data = load_dataset("json", data_files={"train": "/private/dataset/train.jsonl"})
trainer = SFTTrainer(
    model=model,
    processing_class=tokenizer,
    train_dataset=data["train"],
    args=SFTConfig(
        output_dir="/private/adapter-output",
        completion_only_loss=True,
        assistant_only_loss=False,
        packing=False,
        report_to="none",
    ),
    peft_config=LoraConfig(task_type="CAUSAL_LM", r=16, lora_alpha=32),
)
# Do not call trainer.train() before the model-specific checks below.
```

Dataset validation checks structure, hashes, review, grouping and wire frames.
It does **not** prove tokenizer compatibility or model quality. Before training:

- Pin the base model, tokenizer revision, chat-template hash and ML toolchain.
- Apply the selected model's chat template exactly once, without adding model
  control tokens to the canonical JSONL.
- Inspect decoded supervised tokens: nonempty completion, full END marker and
  appropriate EOS; no loss on context, provenance or padding.
- Reject over-length examples instead of truncating away the protocol footer.
- Evaluate on genuinely held-out groups; compare with the prompted base model.

LoRA weights are tied to a compatible base model; the dataset is portable, not a
universal adapter. See [PEFT checkpoint guidance](https://huggingface.co/docs/peft/developer_guides/checkpoint).
Model downloads, QLoRA dependencies, training compute and publishing remain
separate decisions. No training dependencies are installed by Commander.

## Safe rehearsal and current limits

```bash
npm start -- --demo --capture protocol --capture-project synthetic-demo
```

The offline demo uses synthetic conditioning because its internal processes do
not consume Ctrl+P instructions. That provenance is explicit. It is useful for
pipeline checks, not a claim about real LLM reasoning or training quality.

No raw transcripts, private provider context, live replay, automatic review,
automatic deletion or uploads are implemented. Scanner-suppressed echoes and
malformed fragments are not a complete forensic record. The
[implementation plan](session-capture-plan.md) retains these broader boundaries.
