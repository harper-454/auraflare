import { buildPreviewProgram } from '../src/lib/sdf-compiler.ts';

const models = [
  'a ford f150 pickup truck',
  'a red sports car',
  'a cozy house with chimney',
  'a chess pawn',
  'a golden crown',
  'a steel anchor',
  'a hot air balloon',
  'an hourglass',
  'a wooden chair',
  'a steel sword',
];

let ok = 0, fail = 0;
for (const prompt of models) {
  const p = buildPreviewProgram(prompt);
  if (p && p.ops.length >= 2) {
    const total = p.ops.length + (p.parts?.flatMap(x => x.ops).length ?? 0);
    console.log(`✓  "${prompt}"\n   → ${p.label} | ${total} ops | m=${p.metalness?.toFixed(2)??'def'} r=${p.roughness?.toFixed(2)??'def'} | first=${p.ops[0].prim}@[${p.ops[0].pos.map(n=>n.toFixed(2))}]`);
    ok++;
  } else {
    console.log(`✗  "${prompt}" → ${p ? 'only '+p.ops.length+' ops' : 'null'}`);
    fail++;
  }
}
console.log(`\n${ok} passed, ${fail} failed`);
if (fail) process.exit(1);
