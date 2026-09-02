import type { Candidate, DatasetSplit } from './types.js';
import { canonical, sha256 } from './io.js';
import { SYMBOLIC_CAP } from './normalize.js';

function normalized(text: string): string {
  return text.replace(SYMBOLIC_CAP, '<cap>').toLowerCase().replace(/\s+/g, ' ').trim();
}
export function duplicateKey(candidate: Candidate): string {
  return sha256(normalized(canonical({ prompt: candidate.prompt, completion: candidate.completion })));
}
function shingles(candidate: Candidate): Set<string> {
  const words = normalized(candidate.completion[0].content.split('\n').slice(1, -1).join('\n'))
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length < 5) return new Set([words.join(' ')]);
  const values = new Set<string>();
  // A documented, bounded near-duplicate heuristic; review still covers paraphrases.
  for (let i = 0; i + 5 <= words.length && values.size < 256; i++) values.add(words.slice(i, i + 5).join(' '));
  return values;
}

export function groupCandidates(candidates: readonly Candidate[]): { assignments: Record<string, DatasetSplit>; warnings: string[]; groups: string[][] } {
  const projects = [...new Set(candidates.map((candidate) => candidate.projectId))].sort();
  const parents = new Map(projects.map((project) => [project, project]));
  const find = (project: string): string => {
    let parent = parents.get(project)!;
    while (parent !== parents.get(parent)) parent = parents.get(parent)!;
    return parent;
  };
  const join = (a: string, b: string) => {
    const left = find(a), right = find(b);
    if (left !== right) parents.set(left < right ? right : left, left < right ? left : right);
  };
  const signatures = candidates.map(shingles);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < i; j++) {
      if (find(candidates[i].projectId) === find(candidates[j].projectId)) continue;
      const a = signatures[i], b = signatures[j];
      if (Math.min(a.size, b.size) / Math.max(a.size, b.size) < 0.8) continue;
      let intersection = 0;
      for (const shingle of a) if (b.has(shingle)) intersection++;
      if (intersection / (a.size + b.size - intersection) >= 0.8) join(candidates[i].projectId, candidates[j].projectId);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const project of projects) {
    const root = find(project);
    clusters.set(root, [...(clusters.get(root) ?? []), project]);
  }
  const ordered = [...clusters.values()].sort((a, b) => sha256(canonical(a)).localeCompare(sha256(canonical(b))));
  return { ...assignProjectGroups(ordered), groups: ordered };
}

export function assignProjectGroups(groups: readonly string[][]): { assignments: Record<string, DatasetSplit>; warnings: string[] } {
  const ordered = groups.map((members) => [...members].sort()).sort((a, b) => sha256(canonical(a)).localeCompare(sha256(canonical(b))));
  const assignments: Record<string, DatasetSplit> = Object.create(null);
  const heldOutCount = ordered.length >= 3 ? Math.max(1, Math.floor(ordered.length * 0.1)) : 0;
  ordered.forEach((members, index) => {
    const split: DatasetSplit = index < heldOutCount ? 'test' : index < heldOutCount * 2 ? 'validation' : 'train';
    for (const member of members) assignments[member] = split;
  });
  const warnings = [
    'Coverage is Commander-visible only; provider prompts, hidden reasoning and internal tool calls are not captured.',
    'Near-duplicate grouping uses Jaccard >= 0.8 on at most 256 normalized five-token completion shingles; semantic paraphrases require human review.',
    'No model/tokenizer has been selected: token-level loss masks, EOS and context limits are not yet validated.',
  ];
  if (ordered.length < 3) warnings.unshift(`Only ${ordered.length} independent project-family/duplicate group(s): all examples remain in train; held-out splits are empty. No cross-project evaluation claim is supported.`);
  return { assignments, warnings };
}
