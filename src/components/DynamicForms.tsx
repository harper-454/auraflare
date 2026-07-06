import { useCallback } from 'react';
import { ListChecks, Plus, Trash2, CheckCircle2, ArrowUp, ArrowDown, Download } from 'lucide-react';
import { useAutoSave } from '../hooks/useAutoSave';

type QuestionType = 'single' | 'multi' | 'text';

interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
}

interface FormState {
  title: string;
  description: string;
  questions: Question[];
}

type Answers = Record<string, string | string[]>;

const defaultForm: FormState = {
  title: 'Enterprise Configuration Survey',
  description: 'A functional, persisted form. Edits, answers, and structure all survive reloads.',
  questions: [
    { id: 'q1', type: 'single', prompt: 'Which deployment target are you using?', options: ['Cloudflare Workers', 'AWS Lambda', 'Bare metal'] },
    { id: 'q2', type: 'multi', prompt: 'Select required capabilities', options: ['3D Physics Sync', 'WebRTC VoIP', 'Edge Caching'] },
  ],
};

let uid = 0;
const nextId = () => `q${Date.now()}-${uid++}`;

export function DynamicForms() {
  // Real state: persisted via the same autosave pipeline as the spec sections
  const [form, setForm] = useAutoSave<FormState>('dynamic-form-schema', defaultForm);
  const [answers, setAnswers] = useAutoSave<Answers>('dynamic-form-answers', {});

  const updateQuestion = useCallback((id: string, patch: Partial<Question>) => {
    setForm(f => ({ ...f, questions: f.questions.map(q => (q.id === id ? { ...q, ...patch } : q)) }));
  }, [setForm]);

  const move = (idx: number, dir: -1 | 1) => {
    setForm(f => {
      const qs = [...f.questions];
      const j = idx + dir;
      if (j < 0 || j >= qs.length) return f;
      [qs[idx], qs[j]] = [qs[j], qs[idx]];
      return { ...f, questions: qs };
    });
  };

  const addQuestion = (type: QuestionType) => {
    setForm(f => ({
      ...f,
      questions: [...f.questions, {
        id: nextId(), type,
        prompt: 'New question',
        options: type === 'text' ? [] : ['Option A', 'Option B'],
      }],
    }));
  };

  const answer = (q: Question, opt: string) => {
    setAnswers(a => {
      if (q.type === 'single') return { ...a, [q.id]: opt };
      const cur = new Set(Array.isArray(a[q.id]) ? (a[q.id] as string[]) : []);
      cur.has(opt) ? cur.delete(opt) : cur.add(opt);
      return { ...a, [q.id]: [...cur] };
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ schema: form, answers }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'form-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const answeredCount = form.questions.filter(q => {
    const v = answers[q.id];
    return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <ListChecks className="text-indigo-400" /> Dynamic Form Engine
        </h2>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
          PERSISTED · {answeredCount}/{form.questions.length} ANSWERED
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
        <div className="mb-8 border-b border-slate-800 pb-6">
          <input
            type="text"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="text-2xl font-bold bg-transparent text-slate-100 border-none outline-none w-full placeholder:text-slate-600 focus:ring-0 px-0"
          />
          <input
            type="text"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="text-sm bg-transparent text-slate-400 border-none outline-none w-full mt-2 placeholder:text-slate-600 focus:ring-0 px-0"
          />
        </div>

        <div className="space-y-4">
          {form.questions.map((q, idx) => (
            <div key={q.id} className="bg-slate-950 border border-slate-800 rounded-lg p-6 group relative">
              <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => move(idx, -1)} className="p-1.5 text-slate-500 hover:text-slate-200" title="Move up"><ArrowUp className="w-4 h-4" /></button>
                <button onClick={() => move(idx, 1)} className="p-1.5 text-slate-500 hover:text-slate-200" title="Move down"><ArrowDown className="w-4 h-4" /></button>
                <button
                  onClick={() => setForm(f => ({ ...f, questions: f.questions.filter(x => x.id !== q.id) }))}
                  className="p-1.5 text-slate-500 hover:text-rose-400" title="Delete question"
                ><Trash2 className="w-4 h-4" /></button>
              </div>

              <input
                type="text"
                value={q.prompt}
                onChange={e => updateQuestion(q.id, { prompt: e.target.value })}
                className="text-base font-medium bg-transparent text-slate-200 border-none outline-none w-full mb-4 pr-24"
              />

              {q.type === 'text' ? (
                <textarea
                  value={(answers[q.id] as string) ?? ''}
                  onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                  placeholder="Type your answer…"
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              ) : (
                <div className="space-y-2">
                  {q.options.map((opt, oi) => {
                    const selected = q.type === 'single'
                      ? answers[q.id] === opt
                      : Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt);
                    return (
                      <div
                        key={oi}
                        onClick={() => answer(q, opt)}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selected
                            ? 'border-indigo-500/50 bg-indigo-500/10'
                            : 'border-slate-800 hover:bg-slate-800/50'
                        }`}
                      >
                        {q.type === 'single' ? (
                          <div className={`w-4 h-4 rounded-full shrink-0 ${selected ? 'border-4 border-indigo-500 bg-slate-950' : 'border-2 border-slate-600'}`} />
                        ) : (
                          <div className={`w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center ${selected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600'}`}>
                            {selected && <CheckCircle2 className="w-4 h-4 text-slate-950" />}
                          </div>
                        )}
                        <input
                          type="text"
                          value={opt}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            const options = [...q.options];
                            options[oi] = e.target.value;
                            updateQuestion(q.id, { options });
                          }}
                          className={`bg-transparent border-none outline-none text-sm flex-1 ${selected ? 'text-slate-200' : 'text-slate-400'}`}
                        />
                      </div>
                    );
                  })}
                  <button
                    onClick={() => updateQuestion(q.id, { options: [...q.options, `Option ${q.options.length + 1}`] })}
                    className="text-xs text-indigo-400 hover:text-indigo-300 px-1 py-1"
                  >
                    + Add option
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button onClick={() => addQuestion('single')} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm transition-colors border border-slate-700">
            <Plus className="w-4 h-4" /> Single Choice
          </button>
          <button onClick={() => addQuestion('multi')} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm transition-colors border border-slate-700">
            <Plus className="w-4 h-4" /> Multi Choice
          </button>
          <button onClick={() => addQuestion('text')} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm transition-colors border border-slate-700">
            <Plus className="w-4 h-4" /> Free Text
          </button>
          <button onClick={exportJson} className="ml-auto flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm transition-colors">
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </div>
    </div>
  );
}
