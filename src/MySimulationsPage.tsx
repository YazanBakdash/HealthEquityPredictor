import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, History, Trash2 } from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import {
  deleteSimulation,
  listSimulations,
} from './simulations/simulationService';
import type { SavedSimulation } from './simulations/simulationTypes';

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function MySimulationsPage() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [simulations, setSimulations] = useState<SavedSimulation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(true);
    listSimulations()
      .then((rows) => {
        if (isMounted) setSimulations(rows);
      })
      .catch((err) => {
        if (isMounted) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load simulations.');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const accountLabel = useMemo(
    () => user?.user_metadata?.display_name || user?.email || 'Signed in',
    [user],
  );

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm('Delete this saved simulation?');
    if (!confirmed) return;

    setDeletingId(id);
    setErrorMessage(null);

    try {
      await deleteSimulation(id);
      setSimulations((current) => current.filter((simulation) => simulation.id !== id));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete simulation.');
    } finally {
      setDeletingId(null);
    }
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
        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-xs font-semibold text-secondary">
            {accountLabel}
          </span>
          <button
            onClick={() => navigate('/simulator')}
            className="text-sm font-semibold text-secondary hover:text-primary transition-colors"
          >
            Simulator
          </button>
          <button
            onClick={() => signOut()}
            className="text-sm font-semibold text-secondary hover:text-primary transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 pt-28 pb-16">
        <button
          onClick={() => navigate('/simulator')}
          className="flex items-center gap-2 text-sm font-semibold text-secondary hover:text-primary transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Simulator
        </button>

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-4 py-1.5 mb-4">
              <History className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-primary">Saved work</span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-primary font-headline">
              My Simulations
            </h1>
            <p className="text-secondary mt-2">
              Review saved simulator snapshots and reopen them on the map.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-error/20 bg-error/5 px-4 py-3 text-sm font-semibold text-error mb-6">
            {errorMessage}
          </div>
        )}

        {isLoading ? (
          <div className="bg-white rounded-xl border border-outline-variant/20 p-8 text-center text-secondary font-semibold">
            Loading simulations...
          </div>
        ) : simulations.length === 0 ? (
          <div className="bg-white rounded-xl border border-outline-variant/20 p-10 text-center">
            <h2 className="text-xl font-bold text-primary mb-2">No saved simulations yet</h2>
            <p className="text-secondary mb-6">
              Adjust policy sliders in the simulator, then save your first snapshot.
            </p>
            <button
              onClick={() => navigate('/simulator')}
              className="px-5 py-3 bg-primary text-white rounded-lg font-bold hover:opacity-90 transition-opacity"
            >
              Launch Simulator
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {simulations.map((simulation) => {
              const overrideCount = Object.values(
                simulation.tractOverrides as Record<string, Record<string, number>>,
              ).reduce((sum, values) => sum + Object.keys(values).length, 0);
              const parameterCount = Object.keys(simulation.parameterValues).length;

              return (
                <article
                  key={simulation.id}
                  className="bg-white rounded-xl border border-outline-variant/20 p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-primary font-headline">
                        {simulation.title}
                      </h2>
                      <p className="text-xs font-semibold text-secondary mt-1">
                        Saved {formatDate(simulation.updatedAt)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                      {simulation.selectedTractId
                        ? `Tract ${simulation.selectedTractId}`
                        : 'Citywide'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="rounded-lg bg-surface-container-low p-3">
                      <div className="text-[10px] font-bold uppercase text-secondary mb-1">
                        Outcome
                      </div>
                      <div className="text-lg font-extrabold text-primary">
                        {simulation.currentOutcome.toFixed(1)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-surface-container-low p-3">
                      <div className="text-[10px] font-bold uppercase text-secondary mb-1">
                        Change
                      </div>
                      <div
                        className={`text-lg font-extrabold ${
                          simulation.currentOutcomeDiff >= 0 ? 'text-success' : 'text-error'
                        }`}
                      >
                        {simulation.currentOutcomeDiff >= 0 ? '+' : ''}
                        {simulation.currentOutcomeDiff.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-surface-container-low p-3">
                      <div className="text-[10px] font-bold uppercase text-secondary mb-1">
                        Inputs
                      </div>
                      <div className="text-lg font-extrabold text-primary">
                        {parameterCount + overrideCount}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => navigate(`/simulator?simulationId=${simulation.id}`)}
                      className="flex-1 py-2.5 bg-primary text-white rounded-lg font-bold hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open
                    </button>
                    <button
                      onClick={() => handleDelete(simulation.id)}
                      disabled={deletingId === simulation.id}
                      className="p-2.5 rounded-lg border border-outline-variant/30 text-secondary hover:text-error hover:border-error/30 transition-colors disabled:opacity-50"
                      title="Delete simulation"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
