import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Sparkles, Lock, User, AlertCircle, Eye, EyeOff } from 'lucide-react';

function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');
    const res = await login(username, password);
    setLoading(false);

    if (!res.success) {
      setError(res.message);
    }
  };

  return (
    <div className="relative flex min-h-screen w-screen items-center justify-center overflow-hidden bg-slate-900 font-sans text-slate-100">
      {/* Decorative Gradients */}
      <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-primary-600/30 blur-[120px]" />
      <div className="absolute -right-20 -bottom-20 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md p-6">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-8 shadow-2xl backdrop-blur-xl">
          {/* Header Brand */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary-600 to-violet-600 text-white shadow-lg shadow-primary-500/20">
              <Sparkles className="h-8 w-8 animate-pulse" />
            </div>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Welcome to EnthraHub
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Faculty Analytics & Student Coordination Center
            </p>
          </div>

          {/* Form */}
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400 animate-shake">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Username Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Username / Roll No
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                  <User className="h-5 w-5" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. admin or roll number"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-3 pl-11 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-3 pl-11 pr-11 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-primary-600 to-violet-600 py-3 text-sm font-bold text-white shadow-lg shadow-primary-600/20 transition-all hover:opacity-95 hover:shadow-primary-600/30 focus:outline-none disabled:opacity-50"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Logging in...</span>
                </div>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Login;
