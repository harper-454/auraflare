import React, { useState } from 'react';
import { CreditCard, Check, Zap, Users, Shield, Cpu, Globe, Rocket, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

export const BillingSection = () => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const tiers = [
    {
      name: 'Starter',
      price: billingCycle === 'monthly' ? '$0' : '$0',
      description: 'Core engine access for solo developers and hobbyists.',
      features: [
        'Single-Agent Workspace',
        'Basic Code Generation',
        'Local Execution Environment',
        'Standard WebGL Renders',
        'Community Support'
      ],
      current: false,
      buttonText: 'Current Plan',
      popular: false
    },
    {
      name: 'Pro',
      price: billingCycle === 'monthly' ? '$15' : '$144',
      description: 'Advanced capabilities for professional architects.',
      features: [
        'Multi-Agent Custom Personas',
        'Deep Internet Research Swarm',
        'Direct WebGPU Compute Access',
        'Priority GPU Rendering Queues',
        'Private GitHub Sync',
        'Email Support'
      ],
      current: true,
      buttonText: 'Upgrade to Pro',
      popular: true
    },
    {
      name: 'Enterprise',
      price: billingCycle === 'monthly' ? '$99' : '$999',
      description: 'Infinite scale for production teams.',
      features: [
        'Infinite Swarm Scaling',
        'Autonomous Infrastructure Provisioning',
        'Quantum Telemetry & Superposition',
        'Neuromorphic Hardware Bindings',
        'Dedicated Solutions Engineer',
        'SLA 99.99%'
      ],
      current: false,
      buttonText: 'Contact Sales',
      popular: false
    }
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] border-l border-slate-800 relative overflow-hidden">
      {/* Background Ornaments */}
      <div className="absolute top-0 right-0 p-32 opacity-10 pointer-events-none">
        <Rocket className="w-96 h-96 text-indigo-500 blur-3xl" />
      </div>

      <div className="h-14 border-b border-slate-800 flex items-center px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <CreditCard className="text-indigo-400" /> Subscription & Billing
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-12 flex flex-col items-center">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-white mb-4">Unlock the Full Power of Aura</h1>
          <p className="text-slate-400 max-w-xl mx-auto mb-8">
            Upgrade your engine to access multi-agent architectures, deep internet research, WebGPU compute, and autonomous cloud provisioning.
          </p>

          <div className="inline-flex bg-slate-900 border border-slate-800 rounded-full p-1 relative z-10">
            <button 
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-bold transition-colors ${billingCycle === 'monthly' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Monthly
            </button>
            <button 
              onClick={() => setBillingCycle('yearly')}
              className={`px-6 py-2 rounded-full text-sm font-bold transition-colors ${billingCycle === 'yearly' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Yearly <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full ml-1 border border-emerald-500/30">Save 20%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl w-full relative z-10">
          {tiers.map((tier, i) => (
            <motion.div 
              key={tier.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`relative bg-slate-950 border rounded-2xl p-8 flex flex-col ${tier.popular ? 'border-indigo-500 shadow-2xl shadow-indigo-500/10 scale-105' : 'border-slate-800'}`}
            >
              {tier.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  Most Popular
                </div>
              )}
              <h3 className="text-xl font-bold text-white mb-2">{tier.name}</h3>
              <p className="text-sm text-slate-400 mb-6 h-10">{tier.description}</p>
              <div className="mb-8">
                <span className="text-4xl font-bold text-white">{tier.price}</span>
                <span className="text-slate-500 text-sm">/mo</span>
              </div>
              <button 
                className={`w-full py-3 rounded-lg font-bold text-sm mb-8 transition-colors ${
                  tier.popular 
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20' 
                    : 'bg-slate-800 hover:bg-slate-700 text-white'
                }`}
              >
                {tier.buttonText}
              </button>
              <div className="space-y-4 flex-1">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Includes:</div>
                {tier.features.map((f, j) => (
                  <div key={j} className="flex items-start gap-3">
                    <Check className={`w-4 h-4 mt-0.5 ${tier.popular ? 'text-indigo-400' : 'text-slate-600'}`} />
                    <span className="text-sm text-slate-300">{f}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-20 max-w-4xl w-full relative z-10 text-center">
           <h3 className="text-lg font-bold text-white mb-8">Premium Feature Breakdown</h3>
           <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-left">
             <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
               <Globe className="w-6 h-6 text-blue-400 mb-3" />
               <h4 className="text-sm font-bold text-white mb-1">Deep Research</h4>
               <p className="text-xs text-slate-400">Global autonomous crawling and auto-translation.</p>
             </div>
             <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
               <Users className="w-6 h-6 text-amber-400 mb-3" />
               <h4 className="text-sm font-bold text-white mb-1">Multi-Agent Build</h4>
               <p className="text-xs text-slate-400">Configure custom personas for peer-reviewed generation.</p>
             </div>
             <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
               <Zap className="w-6 h-6 text-purple-400 mb-3" />
               <h4 className="text-sm font-bold text-white mb-1">WebGPU Compute</h4>
               <p className="text-xs text-slate-400">Direct VRAM shader pipelines bypassing standard limits.</p>
             </div>
             <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
               <ShieldCheck className="w-6 h-6 text-emerald-400 mb-3" />
               <h4 className="text-sm font-bold text-white mb-1">IaC Provisioning</h4>
               <p className="text-xs text-slate-400">Autonomous infrastructure deployment via Terraform.</p>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};
