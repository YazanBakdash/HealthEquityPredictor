import { useNavigate } from 'react-router-dom';
import {
  Map as MapIcon,
  Activity,
  School,
  TreePine,
  Bus,
  Bike,
  BookOpen,
  ArrowRight,
  User,
  Layers,
  BarChart3,
  FolderSync,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from './auth/AuthProvider';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const displayName =
    typeof user?.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name
      : null;

  return (
    <div className="min-h-screen bg-surface">
      {/* Navigation */}
      <nav className="fixed top-0 w-full flex justify-between items-center px-8 h-16 bg-white/80 backdrop-blur-md border-b border-outline-variant/20 z-50">
        <span className="text-xl font-bold tracking-tighter text-primary font-headline">
          PoliMap
        </span>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/my-simulations')}
            className="text-sm font-semibold text-secondary hover:text-primary transition-colors hidden sm:block"
          >
            Simulator
          </button>
          {user && (
            <button
              onClick={() => navigate('/my-simulations')}
              className="text-sm font-semibold text-secondary hover:text-primary transition-colors hidden sm:block"
            >
              My Simulations
            </button>
          )}
          <button
            onClick={() => navigate(user ? '/profile' : '/auth')}
            className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors cursor-pointer"
            title={user ? 'Profile' : 'Sign in'}
          >
            <User className="w-4 h-4 text-primary" />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-16 min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-success/5" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 25% 40%, rgba(0,43,92,0.06) 0%, transparent 50%), radial-gradient(circle at 75% 60%, rgba(78,222,163,0.06) 0%, transparent 50%)',
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="relative z-10 text-center max-w-3xl mx-auto px-6"
        >
          <div className="inline-flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-full px-4 py-1.5 mb-8">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-semibold text-primary">
              Chicago census tracts · modeled ADI
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-primary font-headline leading-[1.1] mb-6">
            Policy meets
            <br />
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              neighborhood maps
            </span>
          </h1>

          <p className="text-lg text-secondary max-w-xl mx-auto mb-10 leading-relaxed">
            PoliMap is an interactive map of Chicago where every tract links to real amenity and
            built-environment data. Explore layered indicators, place schools and libraries, sketch
            bike routes, adjust tract-level controls where supported, and see how a statistical model
            updates predicted Area Deprivation Index (ADI) as you edit.
          </p>

          {user && (
            <p className="text-sm font-semibold text-primary mb-6">
              Welcome back{displayName ? `, ${displayName}` : ''}. You are signed in.
            </p>
          )}

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={() => navigate('/my-simulations')}
              className="px-8 py-3.5 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 text-base"
            >
              Open simulator
              <ArrowRight className="w-4 h-4" />
            </button>
            {user && (
              <button
                onClick={() => navigate('/my-simulations')}
                className="px-8 py-3.5 bg-white text-primary border border-primary/20 rounded-xl font-bold hover:bg-primary/5 transition-all text-base"
              >
                My Simulations
              </button>
            )}
          </div>
        </motion.div>

        {/* Decorative preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25, ease: 'easeOut' }}
          className="relative z-10 mt-16 w-full max-w-4xl mx-auto px-6"
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-outline-variant/20 p-1.5 overflow-hidden">
            <div className="bg-gradient-to-br from-slate-50 via-white to-surface-container-low rounded-xl h-56 md:h-64 relative overflow-hidden">
              <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_20%_20%,rgba(78,222,163,0.18),transparent_28%),radial-gradient(circle_at_80%_40%,rgba(174,199,247,0.22),transparent_30%)]" />
              <svg
                viewBox="0 0 720 250"
                role="img"
                aria-label="Interactive census tract map preview"
                className="absolute inset-0 w-full h-full"
              >
                <g transform="translate(250 22) rotate(-8)">
                  {[
                    ['M90 30L150 20L176 62L132 92L82 76Z', '#4EDEA3'],
                    ['M152 21L214 44L205 95L176 62Z', '#AEC7F7'],
                    ['M82 78L132 94L126 148L64 136L48 96Z', '#E98D8D'],
                    ['M134 94L205 97L226 148L164 176L126 150Z', '#4EDEA3'],
                    ['M206 98L270 86L306 126L262 178L228 150Z', '#AEC7F7'],
                    ['M50 98L64 138L28 174L0 132Z', '#BA1A1A'],
                    ['M66 140L126 152L118 212L48 202L30 176Z', '#AEC7F7'],
                    ['M128 152L164 178L146 232L118 214Z', '#4EDEA3'],
                    ['M166 178L264 180L232 238L148 234Z', '#E98D8D'],
                    ['M264 180L308 128L346 172L322 228L234 240Z', '#4EDEA3'],
                  ].map(([path, fill], index) => (
                    <path
                      key={index}
                      d={path}
                      fill={fill}
                      fillOpacity="0.9"
                      stroke="white"
                      strokeWidth="4"
                      className="drop-shadow-sm"
                    />
                  ))}
                </g>
              </svg>

              <div className="absolute left-5 top-5 glass-panel rounded-xl border border-white/60 shadow-lg px-4 py-3 text-left">
                <div className="flex items-center gap-2 text-primary">
                  <MapIcon className="w-4 h-4" />
                  <span className="text-xs font-headline font-bold">
                    Tract choropleth & layers
                  </span>
                </div>
                <p className="text-[10px] text-secondary mt-1">
                  ADI, amenities, and infrastructure
                </p>
              </div>

              <div className="absolute right-5 bottom-5 glass-panel rounded-xl border border-white/60 shadow-lg p-3">
                <div className="text-[9px] font-bold text-secondary uppercase tracking-widest mb-2">
                  Modeled ADI
                </div>
                <div className="flex items-center gap-1.5">
                  {['#BA1A1A', '#E98D8D', '#AEC7F7', '#4EDEA3'].map((color) => (
                    <span
                      key={color}
                      className="w-7 h-2 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="absolute left-1/2 top-1/2 -translate-x-2 -translate-y-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative w-4 h-4 rounded-full bg-primary border-2 border-white shadow-lg" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce opacity-30">
          <ArrowRight className="w-5 h-5 rotate-90 text-primary" />
        </div>
      </section>

      {/* Highlights */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-extrabold text-primary font-headline mb-4">
              What PoliMap does
            </h2>
            <p className="text-secondary max-w-2xl mx-auto leading-relaxed">
              The simulator ties together open tract-level features, seeded school and library
              locations, optional geometry you draw on the map, and a recalculation pipeline that
              refreshes tract outputs and ADI estimates—without claiming to predict individual health
              outcomes.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
            {[
              {
                icon: <Layers className="w-6 h-6" />,
                title: 'Layered Chicago data',
                desc: 'Choropleth views across hundreds of tracts: modeled ADI plus metrics such as tree canopy, parks, transit, bike infrastructure, Wi‑Fi hotspots, schools, libraries, housing, and small-business density—aligned to the same baseline dataset used in the app.',
              },
              {
                icon: <Sparkles className="w-6 h-6" />,
                title: 'Edit scenarios, rerun the model',
                desc: 'Place schools or libraries, draw bike trails, and where the UI allows it adjust tract sliders; each change triggers a backend recalculation so mapped values and predicted ADI stay consistent with your scenario.',
              },
              {
                icon: <FolderSync className="w-6 h-6" />,
                title: 'Saved simulations',
                desc: 'Signed-in users store scenarios in the cloud—geometry and tract-level results persist so you can reopen and iterate on a map later.',
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center p-6"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/5 flex items-center justify-center mx-auto mb-4 text-primary">
                  {item.icon}
                </div>
                <h3 className="font-headline font-bold text-on-surface mb-2 text-lg">
                  {item.title}
                </h3>
                <p className="text-sm text-secondary leading-relaxed">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Tools & data — replaces generic policy sliders */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-extrabold text-primary font-headline mb-4">
              Inside the simulator
            </h2>
            <p className="text-secondary max-w-2xl mx-auto leading-relaxed">
              These are the kinds of controls and data sources wired into the live map—not abstract
              placeholder sliders.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              {
                icon: <Activity className="w-5 h-5" />,
                title: 'ADI & tract features',
                desc: 'Visualize modeled Area Deprivation Index alongside tract attributes derived from consolidated Chicago neighborhood datasets (tree canopy, parks, transit stops, affordability proxies, food access, and more).',
              },
              {
                icon: (
                  <span className="flex items-center gap-1">
                    <School className="w-5 h-5" />
                    <BookOpen className="w-5 h-5 -ml-1" />
                  </span>
                ),
                title: 'Schools & public libraries',
                desc: 'Baseline points come from seeded CPS and Chicago Public Library coordinates; you can add sites on the map so densities respect buffers used in the spatial engine.',
              },
              {
                icon: <Bike className="w-5 h-5" />,
                title: 'Bike trails & miles',
                desc: 'Sketch routes on the Bike Miles layer to layer onto baseline bike and trail mileage; recalculation clips geometry to tracts using the same buffers as other linear features.',
              },
              {
                icon: <Bus className="w-5 h-5" />,
                title: 'Transit & connectivity',
                desc: 'Explore transit-stop density and complementary layers (e.g. Wi‑Fi hotspots) as choropleths to compare mobility and digital access patterns tract by tract.',
              },
              {
                icon: <TreePine className="w-5 h-5" />,
                title: 'Environment & amenities',
                desc: 'Tree canopy, parks, and related layers help illustrate green space and public amenity context next to modeled deprivation.',
              },
              {
                icon: <BarChart3 className="w-5 h-5" />,
                title: 'Tract-level tweaks',
                desc: 'Where a layer exposes sliders on a selected tract, adjustments feed into the same recalculation path so histograms and legends reflect your overrides.',
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="bg-white rounded-xl p-6 border border-outline-variant/20 hover:shadow-lg hover:border-primary/20 transition-all group cursor-default"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center mb-4 text-primary group-hover:bg-primary group-hover:text-white transition-all [&>span]:gap-0">
                  {item.icon}
                </div>
                <h3 className="font-headline font-bold text-on-surface mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-secondary leading-relaxed">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="bg-primary rounded-2xl p-12 text-white relative overflow-hidden"
          >
            <div
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 30% 70%, rgba(78,222,163,0.5) 0%, transparent 50%)',
              }}
            />
            <div className="relative z-10">
              <h2 className="text-3xl font-extrabold font-headline mb-4">
                Try it on Chicago tracts
              </h2>
              <p className="text-white/70 mb-8 max-w-md mx-auto">
                Sign in to save simulations, or jump in and explore the map with seeded data and
                instant recalculation.
              </p>
              <button
                onClick={() => navigate('/my-simulations')}
                className="px-8 py-3.5 bg-white text-primary rounded-xl font-bold hover:bg-white/90 transition-all inline-flex items-center gap-2"
              >
                Get started
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-outline-variant/20">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-bold tracking-tighter text-primary font-headline">
            PoliMap
          </span>
          <span className="text-xs text-secondary text-center sm:text-right">
            Research-oriented mapping tool · IEEE Health Equity context · Not a clinical or policy
            decision system
          </span>
        </div>
      </footer>
    </div>
  );
}
