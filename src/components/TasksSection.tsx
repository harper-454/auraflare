import { useMemo, FormEvent, useState } from 'react';
import { useAutoSave } from '../hooks/useAutoSave';
import { motion } from 'motion/react';
import { projectData } from '../data';
import { Task } from '../types';
import { Bot, User, Plus, CheckCircle, Clock, Circle, Filter } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

const CATEGORIES = [
  { id: 'core', label: 'Core Engine' },
  { id: 'ai', label: 'AI Agent' },
  { id: '3d', label: '3D Viewport' },
  { id: 'export', label: 'Game Export' },
  { id: 'media', label: 'Generative Media' },
  { id: 'integrations', label: 'Model Integrations' }
] as const;

export function TasksSection() {
  const [tasks, setTasks] = useAutoSave<Task[]>('tasks', projectData.tasks);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  
  // Filtering states
  const [selectedCategory, setSelectedCategory] = useAutoSave<string>('tasks-category', 'all');
  const [selectedAssignee, setSelectedAssignee] = useAutoSave<string>('tasks-assignee', 'all');
  
  // Form state for creating a new task
  const [showAddForm, setShowAddForm] = useAutoSave('tasks-showForm', false);
  const [newTaskTitle, setNewTaskTitle] = useAutoSave('tasks-newTitle', '');
  const [newTaskCategory, setNewTaskCategory] = useAutoSave<'core' | 'ai' | '3d' | 'export' | 'media' | 'integrations'>('tasks-newCategory', 'core');
  const [newTaskAssignee, setNewTaskAssignee] = useAutoSave<'human' | 'ai-agent'>('tasks-newAssignee', 'human');
  const [newTaskComplexity, setNewTaskComplexity] = useAutoSave('tasks-newComplexity', 'Medium');

  // Cycle task status handler
  const handleCycleStatus = (taskId: string) => {
    setTasks(prevTasks =>
      prevTasks.map(task => {
        if (task.id === taskId) {
          const nextStatusMap: Record<Task['status'], Task['status']> = {
            todo: 'in-progress',
            'in-progress': 'done',
            done: 'todo'
          };
          return { ...task, status: nextStatusMap[task.status] };
        }
        return task;
      })
    );
  };

  // Add new task handler
  const handleAddTask = (e: FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const nextIdNumber = tasks.length + 1;
    const paddedId = String(nextIdNumber).padStart(2, '0');
    
    const newTask: Task = {
      id: `TSK-${paddedId}`,
      title: newTaskTitle.trim(),
      status: 'todo',
      assignee: newTaskAssignee,
      complexity: newTaskComplexity,
      category: newTaskCategory
    };

    setTasks(prev => [...prev, newTask]);
    setNewTaskTitle('');
    setShowAddForm(false);
  };

  // Calculate chart statistics dynamically based on current tasks state
  const chartData = useMemo(() => {
    return CATEGORIES.map(cat => {
      const catTasks = tasks.filter(t => t.category === cat.id);
      const total = catTasks.length;
      const done = catTasks.filter(t => t.status === 'done').length;
      const inProgress = catTasks.filter(t => t.status === 'in-progress').length;
      
      // Weight completion: done is 100%, in-progress is 50%
      const completionPercent = total > 0 
        ? Math.round(((done + inProgress * 0.5) / total) * 100) 
        : 0;

      return {
        name: cat.label,
        'Completion %': completionPercent,
        Tasks: total,
        Done: done,
        'In Progress': inProgress
      };
    });
  }, [tasks]);

  const allocationData = useMemo(() => {
    const humanTasks = tasks.filter(t => t.assignee === 'human').length;
    const aiTasks = tasks.filter(t => t.assignee === 'ai-agent').length;
    return [
      { name: 'Human Developers', value: humanTasks, color: '#94a3b8' },
      { name: 'Aura AI Agents', value: aiTasks, color: '#6366f1' }
    ];
  }, [tasks]);

  // Overall Completion stats
  const overallStats = useMemo(() => {
    const total = tasks.length;
    if (total === 0) return { percent: 0, done: 0, aiPercent: 0 };
    
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress').length;
    const percent = Math.round(((done + inProgress * 0.5) / total) * 100);
    
    const aiTasks = tasks.filter(t => t.assignee === 'ai-agent').length;
    const aiPercent = Math.round((aiTasks / total) * 100);

    return { percent, done, aiPercent, total };
  }, [tasks]);

  // Filter tasks for the table view
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const matchCategory = selectedCategory === 'all' || t.category === selectedCategory;
      const matchAssignee = selectedAssignee === 'all' || t.assignee === selectedAssignee;
      return matchCategory && matchAssignee;
    });
  }, [tasks, selectedCategory, selectedAssignee]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl space-y-8"
    >
      <header className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight text-slate-100">Autonomous Task Queue</h2>
        <p className="text-lg text-slate-400">
          Real-time execution metrics and collaborative task allocation between developers and automated AI agents.
        </p>
      </header>

      {/* Real-time Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="p-6 rounded-lg bg-slate-900 border border-slate-800">
          <div className="text-xs font-mono text-slate-500 mb-1">OVERALL COMPLETION RATIO</div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-indigo-400 font-mono">{overallStats.percent}%</span>
            <span className="text-sm text-slate-500">({overallStats.done} / {overallStats.total} done)</span>
          </div>
          <div className="w-full bg-slate-950 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${overallStats.percent}%` }}></div>
          </div>
        </div>

        <div className="p-6 rounded-lg bg-slate-900 border border-slate-800">
          <div className="text-xs font-mono text-slate-500 mb-1">AI AUTONOMY RATE</div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-emerald-400 font-mono">{overallStats.aiPercent}%</span>
            <span className="text-sm text-slate-500">automated sessions</span>
          </div>
          <div className="w-full bg-slate-950 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${overallStats.aiPercent}%` }}></div>
          </div>
        </div>

        <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="text-xs font-mono text-slate-500 mb-1">TOTAL TASK QUEUE SIZE</div>
            <div className="text-3xl font-bold text-slate-200 font-mono">{overallStats.total} active</div>
          </div>
          <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 mt-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            ACTIVE TELEMETRY SYNCED
          </div>
        </div>
      </div>

      {/* Visual Analytics - Recharts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Domain Progress Horizontal Bar Chart */}
        <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-200">Domain Completion %</h3>
            <p className="text-xs text-slate-500 mb-4 font-mono">WEIGHTED: DONE = 100% | IN-PROGRESS = 50%</p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <XAxis type="number" domain={[0, 100]} stroke="#475569" className="text-[10px] font-mono" />
                <YAxis dataKey="name" type="category" stroke="#475569" className="text-[10px] font-sans" width={90} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '6px' }}
                  labelStyle={{ color: '#f1f5f9', fontWeight: 'bold' }}
                />
                <Bar dataKey="Completion %" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20}>
                  {chartData.map((entry, index) => {
                    const colors = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#06b6d4'];
                    return (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={colors[index % colors.length]} 
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Workforce Resource Allocation Donut Chart */}
        <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-200">Task Allocation</h3>
            <p className="text-xs text-slate-500 mb-4 font-mono">HUMAN VS AUTONOMOUS AI SESSIONS</p>
          </div>
          <div className="h-64 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={allocationData}
                  cx="50%"
                  cy="45%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {allocationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '6px' }}
                  itemStyle={{ color: '#f1f5f9' }}
                />
                <Legend 
                  verticalAlign="bottom" 
                  height={36} 
                  iconType="circle"
                  formatter={(value, entry: any) => (
                    <span className="text-xs text-slate-400 font-sans">{value}: {entry.payload.value} tasks</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Task Filters & Creation */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-500 uppercase">
              <Filter className="w-3.5 h-3.5" />
              Filter by:
            </div>
            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Domains</option>
              {CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.label}</option>
              ))}
            </select>

            {/* Assignee Filter */}
            <select
              value={selectedAssignee}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Assignees</option>
              <option value="human">Human Developers</option>
              <option value="ai-agent">Aura AI Agent</option>
            </select>
          </div>

          
          <button
            onClick={() => setViewMode(viewMode === 'table' ? 'kanban' : 'table')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-md text-sm font-medium transition-colors"
          >
            {viewMode === 'table' ? 'Kanban View' : 'Table View'}
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}

            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Custom Task
          </button>
        </div>

        {/* Quick Add Task Form */}
        {showAddForm && (
          <motion.form 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            onSubmit={handleAddTask}
            className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-mono text-slate-500 uppercase mb-1">Task Title</label>
                <input
                  type="text"
                  placeholder="e.g. Implement collision response callbacks"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-500 uppercase mb-1">Domain</label>
                <select
                  value={newTaskCategory}
                  onChange={(e) => setNewTaskCategory(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-500 uppercase mb-1">Assignee</label>
                <select
                  value={newTaskAssignee}
                  onChange={(e) => setNewTaskAssignee(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="human">Human Developer</option>
                  <option value="ai-agent">Aura AI Agent</option>
                </select>
              </div>
            </div>
            
            <div className="flex justify-between items-center pt-2">
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-slate-500 uppercase">Complexity:</span>
                {['Low', 'Medium', 'High', 'Extreme'].map((comp) => (
                  <label key={comp} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="complexity"
                      value={comp}
                      checked={newTaskComplexity === comp}
                      onChange={() => setNewTaskComplexity(comp)}
                      className="text-indigo-600 focus:ring-0"
                    />
                    {comp}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded"
                >
                  Create Task
                </button>
              </div>
            </div>
          </motion.form>
        )}

        {/* Task List Table */}
        
        {viewMode === 'kanban' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(['todo', 'in-progress', 'done'] as const).map(status => (
              <div key={status} className="bg-slate-900/50 rounded-lg border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-bold text-slate-300 capitalize flex items-center gap-2">
                    {status === 'done' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : status === 'in-progress' ? <Clock className="w-4 h-4 text-indigo-400" /> : <Circle className="w-4 h-4 text-slate-400" />}
                    {status.replace('-', ' ')}
                  </h4>
                  <span className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                    {filteredTasks.filter(t => t.status === status).length}
                  </span>
                </div>
                <div className="space-y-3">
                  {filteredTasks.filter(t => t.status === status).map(task => (
                    <motion.div 
                      key={task.id}
                      layoutId={task.id}
                      className="bg-slate-950 p-4 rounded border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors"
                      onClick={() => handleCycleStatus(task.id)}
                      title="Click to advance status"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-mono text-slate-500">{task.id}</span>
                        <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${task.complexity === 'Extreme' ? 'bg-rose-500/10 text-rose-400' : task.complexity === 'High' ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                          {task.complexity}
                        </span>
                      </div>
                      <h5 className="text-sm font-medium text-slate-200 mb-2">{task.title}</h5>
                      <div className="flex justify-between items-center mt-3">
                        <div className="flex items-center gap-1.5">
                          {task.assignee === 'ai-agent' ? <Bot className="w-3.5 h-3.5 text-indigo-400" /> : <User className="w-3.5 h-3.5 text-slate-400" />}
                          <span className="text-xs text-slate-400">{task.assignee === 'ai-agent' ? 'AI' : 'Human'}</span>
                        </div>
                        <span className="text-xs text-slate-500 font-mono">{CATEGORIES.find(c => c.id === task.category)?.label || task.category}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-slate-800/50 rounded-lg overflow-hidden">

          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-slate-950 text-slate-500 font-mono text-xs uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">Task ID</th>
                <th className="px-6 py-4 font-medium">Description</th>
                <th className="px-6 py-4 font-medium">Domain</th>
                <th className="px-6 py-4 font-medium">Status (Click to Cycle)</th>
                <th className="px-6 py-4 font-medium">Assignee</th>
                <th className="px-6 py-4 font-medium">Complexity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 font-mono text-xs">
                    NO TASKS FOUND MATCHING CURRENT FILTERS
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{task.id}</td>
                    <td className="px-6 py-4 text-slate-300 font-medium">
                      <div>{task.title}</div>
                      {task.resolutionSteps && (
                        <div className="mt-2 p-2 bg-indigo-950/20 border border-indigo-900/50 rounded text-[10px] text-indigo-300 font-mono">
                          <div className="uppercase tracking-wider font-bold mb-1 opacity-70">AI Resolution Plan:</div>
                          {task.resolutionSteps}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs font-mono">
                      {CATEGORIES.find(c => c.id === task.category)?.label || task.category}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleCycleStatus(task.id)}
                        className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer select-none transition-all hover:scale-105 active:scale-95 ${
                          task.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                          task.status === 'in-progress' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                          'bg-slate-800/50 border-slate-700 text-slate-400'
                        }`}
                        title="Click to toggle status: Todo -> In Progress -> Done"
                      >
                        {task.status === 'done' ? (
                          <CheckCircle className="w-3.5 h-3.5" />
                        ) : task.status === 'in-progress' ? (
                          <Clock className="w-3.5 h-3.5" />
                        ) : (
                          <Circle className="w-3.5 h-3.5" />
                        )}
                        <span className="capitalize">{task.status.replace('-', ' ')}</span>
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {task.assignee === 'ai-agent' ? (
                          <><Bot className="w-4 h-4 text-indigo-400" /> <span className="text-indigo-200">Aura AI</span></>
                        ) : (
                          <><User className="w-4 h-4 text-slate-400" /> <span className="text-slate-300">Human</span></>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{task.complexity}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table></div>)}
      </div>
    </motion.div>
  );
}
