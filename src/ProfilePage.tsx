import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, History, LogOut, User } from 'lucide-react';
import { useAuth } from './auth/AuthProvider';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  const displayName = useMemo(
    () =>
      typeof user?.user_metadata?.display_name === 'string'
        ? user.user_metadata.display_name
        : null,
    [user],
  );

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-surface">
      <nav className="fixed top-0 w-full flex justify-between items-center px-6 h-16 bg-white/80 backdrop-blur-md border-b border-outline-variant/20 shadow-sm z-50">
        <button
          onClick={() => navigate('/')}
          className="text-xl font-bold tracking-tighter text-primary font-headline hover:opacity-80 transition-opacity"
        >
          Policy Intel Chicago
        </button>
        <button
          onClick={() => navigate('/simulator')}
          className="text-sm font-semibold text-secondary hover:text-primary transition-colors"
        >
          Simulator
        </button>
      </nav>

      <main className="mx-auto max-w-3xl px-6 pt-28 pb-16">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm font-semibold text-secondary hover:text-primary transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <section className="bg-white rounded-2xl border border-outline-variant/20 p-8 shadow-sm">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-primary font-headline">
                Profile
              </h1>
              <p className="text-secondary mt-1">
                Manage your Policy Intel Chicago account.
              </p>
            </div>
          </div>

          <div className="space-y-4 mb-8">
            <div className="rounded-xl bg-surface-container-low p-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-secondary mb-1">
                Name
              </div>
              <div className="font-bold text-on-surface">{displayName || 'Not set'}</div>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-secondary mb-1">
                Email
              </div>
              <div className="font-bold text-on-surface">{user?.email}</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => navigate('/my-simulations')}
              className="flex-1 py-3 bg-primary text-white rounded-lg font-bold hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2"
            >
              <History className="w-4 h-4" />
              My Simulations
            </button>
            <button
              onClick={handleSignOut}
              className="flex-1 py-3 border border-outline-variant/40 text-secondary rounded-lg font-bold hover:text-error hover:border-error/30 transition-colors inline-flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
