import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Mail, Lock, User, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from './auth/AuthProvider';

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, signUp, user } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectTo = useMemo(
    () => searchParams.get('redirectTo') || '/',
    [searchParams],
  );

  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true });
  }, [navigate, redirectTo, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      if (isLogin) {
        await signIn(email, password);
        navigate(redirectTo, { replace: true });
      } else {
        await signUp(email, password, name);
        setSuccessMessage('Account created. Check your email if confirmation is enabled.');
        navigate(redirectTo, { replace: true });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex w-1/2 bg-primary relative overflow-hidden flex-col justify-between p-12">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'radial-gradient(circle at 30% 70%, rgba(78,222,163,0.5) 0%, transparent 50%), radial-gradient(circle at 70% 30%, rgba(174,199,247,0.4) 0%, transparent 50%)',
          }}
        />

        <div className="relative z-10">
          <button
            onClick={() => navigate('/')}
            className="text-2xl font-bold tracking-tighter text-white font-headline hover:opacity-80 transition-opacity"
          >
            Policy Intel Chicago
          </button>
        </div>

        <div className="relative z-10">
          <h2 className="text-4xl font-extrabold text-white font-headline leading-tight mb-4">
            Data-driven insights
            <br />
            for healthier communities
          </h2>
          <p className="text-white/60 text-lg max-w-md">
            Simulate, analyze, and understand how policy decisions affect health
            equity across Chicago.
          </p>
        </div>

        <div className="relative z-10 flex gap-8">
          {[
            { value: '801', label: 'Census Tracts' },
            { value: '5', label: 'Policy Areas' },
            { value: '12', label: 'Parameters' },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="text-3xl font-extrabold text-white font-headline">
                {stat.value}
              </div>
              <div className="text-white/50 text-sm">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm font-semibold text-secondary hover:text-primary transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </button>

          <div className="lg:hidden mb-8">
            <span className="text-xl font-bold tracking-tighter text-primary font-headline">
              Policy Intel Chicago
            </span>
          </div>

          <h1 className="text-3xl font-extrabold text-primary font-headline mb-2">
            {isLogin ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="text-secondary mb-8">
            {isLogin
              ? 'Sign in to access your simulations.'
              : 'Get started with Policy Intel Chicago.'}
          </p>

          {/* Toggle */}
          <div className="flex bg-surface-container-low rounded-lg p-1 mb-8">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-md transition-all ${
                isLogin
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-md transition-all ${
                !isLogin
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label className="text-xs font-bold text-secondary uppercase tracking-wider mb-1.5 block">
                  Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary/40" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    required={!isLogin}
                    className="w-full pl-10 pr-4 py-3 bg-white border border-outline-variant/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </motion.div>
            )}

            <div>
              <label className="text-xs font-bold text-secondary uppercase tracking-wider mb-1.5 block">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary/40" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                    required
                  className="w-full pl-10 pr-4 py-3 bg-white border border-outline-variant/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-secondary uppercase tracking-wider mb-1.5 block">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary/40" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                    required
                    minLength={6}
                  className="w-full pl-10 pr-12 py-3 bg-white border border-outline-variant/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary/40 hover:text-secondary transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {isLogin && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {errorMessage && (
              <div className="rounded-lg border border-error/20 bg-error/5 px-4 py-3 text-sm font-semibold text-error">
                {errorMessage}
              </div>
            )}

            {successMessage && (
              <div className="rounded-lg border border-success/20 bg-success/5 px-4 py-3 text-sm font-semibold text-primary">
                {successMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 bg-primary text-white rounded-lg font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60 disabled:hover:scale-100"
            >
              {isSubmitting ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-xs text-secondary mt-8">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary font-semibold hover:underline"
            >
              {isLogin ? 'Sign Up' : 'Sign In'}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
