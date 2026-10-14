import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Key, ShieldCheck, AlertTriangle, Loader2, Info } from 'lucide-react';
import { useRepoStore } from '../store/useRepoStore';

interface ApiKeySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ApiKeySettings({ isOpen, onClose }: ApiKeySettingsProps) {
  const { aiKey, aiProvider, setAiKeyAndProvider, testAiKey } = useRepoStore();
  
  const [selectedProvider, setSelectedProvider] = useState(
    aiProvider === 'gemini' || aiProvider === 'openrouter' ? aiProvider : 'default'
  );
  const [tempKey, setTempKey] = useState(aiKey || '');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Every AI feature in RepoPilot runs on Gemma 4. A user key only changes which
  // account pays for the Gemma 4 calls, never which model is used.
  const providers = [
    { id: 'default', name: 'RepoPilot Gemma 4 (Default)', desc: 'Use our hosted Gemma 4 with built-in rate limits.', color: 'text-purple-400' },
    { id: 'gemini', name: 'Google AI Studio key (Gemma 4)', desc: 'Runs Gemma 4 31B on your own Google AI Studio / Gemini API key (starts with "AIza").', color: 'text-blue-400' },
    { id: 'openrouter', name: 'OpenRouter key (Gemma 4)', desc: 'Runs google/gemma-4-31b-it through your own OpenRouter key (starts with "sk-or-").', color: 'text-indigo-400' }
  ];

  const handleTestAndSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (selectedProvider === 'default') {
      setAiKeyAndProvider('', 'default');
      setTestResult({ success: true, message: 'Settings saved.' });
      setTimeout(onClose, 1000);
      return;
    }

    if (!tempKey.trim()) {
      setTestResult({ success: false, message: 'API key is required.' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const isValid = await testAiKey(selectedProvider, tempKey.trim());
      if (isValid) {
        setTestResult({ success: true, message: 'Connection successful! Key saved.' });
        setAiKeyAndProvider(tempKey.trim(), selectedProvider);
        setTimeout(onClose, 1500);
      } else {
        setTestResult({ success: false, message: 'Invalid key or provider rejected the request.' });
      }
    } catch (error: any) {
      setTestResult({ success: false, message: error.response?.data?.error || error.message || 'Failed to verify key.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleClear = () => {
    setSelectedProvider('default');
    setTempKey('');
    setAiKeyAndProvider('', 'default');
    setTestResult({ success: true, message: 'Custom key removed.' });
  };

  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg glass-panel bg-[#0d1117]/95 border border-[var(--border-color)] rounded-xl shadow-2xl p-6 z-10"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <Key className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">API Key Settings</h2>
                <p className="text-xs text-slate-400 font-mono">Every AI feature runs on Gemma 4</p>
              </div>
            </div>

            <form onSubmit={handleTestAndSave} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
                  Gemma 4 access
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => {
                    setSelectedProvider(e.target.value);
                    setTestResult(null);
                  }}
                  className="w-full bg-[#161b22] border border-slate-700 hover:border-slate-600 focus:border-cyan-500 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none transition-colors"
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400">
                  {providers.find(p => p.id === selectedProvider)?.desc}
                </p>
              </div>

              {selectedProvider !== 'default' && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={tempKey}
                    onChange={(e) => {
                      setTempKey(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder={selectedProvider === 'openrouter' ? 'sk-or-v1-...' : 'AIza...'}
                    className="w-full bg-[#161b22] border border-slate-700 hover:border-slate-600 focus:border-cyan-500 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none transition-colors font-mono"
                  />
                  <div className="flex items-start space-x-2 text-[10px] text-slate-400 bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-lg mt-2">
                    <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <p>Your key is stored locally in this browser session. It is never saved to our database, maximizing security and privacy.</p>
                  </div>
                </div>
              )}

              {testResult && (
                <div className={`flex items-start space-x-2 p-3 rounded-lg text-xs font-mono border ${
                  testResult.success 
                    ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  {testResult.success ? (
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <p>{testResult.message}</p>
                </div>
              )}

              <div className="pt-4 flex items-center justify-between border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs text-slate-400 hover:text-red-400 transition-colors uppercase font-mono tracking-wider cursor-pointer"
                >
                  Clear Custom Key
                </button>
                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-xs font-mono tracking-wider text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    disabled={isTesting || (selectedProvider !== 'default' && !tempKey.trim())}
                    className="flex items-center space-x-2 px-5 py-2 rounded-lg text-xs font-mono tracking-wider text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_10px_rgba(8,145,178,0.2)] cursor-pointer"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>TESTING...</span>
                      </>
                    ) : (
                      <span>{selectedProvider === 'default' ? 'SAVE' : 'TEST & SAVE'}</span>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
