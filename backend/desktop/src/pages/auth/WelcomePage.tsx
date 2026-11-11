import { useNavigate } from 'react-router-dom';
import {
  Mail,
  BookOpen,
  Cloud,
  Building2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { setGuestMode, googleSignIn } from '@/store/slices/authSlice';
import { selectAuthLoading, selectAuthError, selectProviderLinking } from '@/store';
import BrandMark from '@/components/common/BrandMark';
import heroImage from '@/assets/ob-01-welcome.png';

interface Feature {
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  accent: string;
}

// Feature copy sourced verbatim from RN HomeScreen + marketing
const FEATURES: Feature[] = [
  {
    icon: Mail,
    title: 'Compras desde Gmail',
    description: 'Importa automáticamente los DTEs que recibes por correo',
    accent: 'bg-purple-500/20 text-purple-300',
  },
  {
    icon: BookOpen,
    title: 'Libros de IVA',
    description: 'Genera y exporta tus libros fiscales listos para presentar',
    accent: 'bg-amber-500/20 text-amber-300',
  },
  {
    icon: Cloud,
    title: 'Exportación Completa',
    description: 'Excel, JSON, PDF y respaldo en Google Drive',
    accent: 'bg-sky-500/20 text-sky-300',
  },
  {
    icon: Building2,
    title: 'Multi-Empresa',
    description: 'Centraliza la facturación de múltiples emisores en un solo lugar',
    accent: 'bg-emerald-500/20 text-emerald-300',
  },
];

export default function WelcomePage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const loading = useAppSelector(selectAuthLoading);
  const error = useAppSelector(selectAuthError);
  const providerLinking = useAppSelector(selectProviderLinking);

  function handleGuest() {
    dispatch(setGuestMode(true));
    navigate('/onboarding');
  }

  async function handleGoogleSignIn() {
    const result = await dispatch(googleSignIn());
    if (googleSignIn.fulfilled.match(result) && result.payload.authenticated) {
      navigate('/home');
    }
  }

  return (
    <div
      data-testid="welcome"
      className="relative min-h-screen w-full overflow-hidden text-white"
      style={{
        background:
          'linear-gradient(135deg, #0b1220 0%, #13213a 50%, #0f3b3a 100%)',
      }}
    >
      {/* Decorative soft orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[420px] h-[420px] rounded-full bg-accent-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[480px] h-[480px] rounded-full bg-sky-400/15 blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-1 h-1 rounded-full bg-white/30" />
        <div className="absolute top-1/4 left-1/3 w-1 h-1 rounded-full bg-white/30" />
        <div className="absolute bottom-1/3 left-1/5 w-1 h-1 rounded-full bg-white/20" />
      </div>

      <div className="relative min-h-screen grid grid-cols-1 lg:grid-cols-2">
        {/* ─── LEFT: brand + hero ─────────────────────────────────────── */}
        <section className="flex flex-col justify-center px-10 xl:px-20 py-12 order-2 lg:order-1">
          <div className="max-w-xl mx-auto lg:mx-0 w-full">
            {/* Brand mark + wordmark */}
            <div className="flex items-center gap-4 mb-8">
              <BrandMark size={64} className="shrink-0 rounded-2xl drop-shadow-xl" />
              <h1 className="text-4xl xl:text-5xl font-bold tracking-tight">
                Sparkle<span className="text-sky-400">Wash</span>
              </h1>
            </div>

            <h2 className="text-3xl xl:text-4xl font-bold leading-tight mb-4">
              Facturación electrónica sin complicaciones
            </h2>
            <p className="text-white/70 text-lg leading-relaxed mb-10">
              Gestiona tus documentos tributarios electrónicos, de manera fácil
              y rápida. Multi-empresa y exportación completa en un solo lugar.
            </p>

            {/* Hero illustration */}
            <div className="hidden md:flex justify-center mb-8">
              <img
                src={heroImage}
                alt=""
                className="w-64 xl:w-80 object-contain drop-shadow-2xl"
              />
            </div>

            {/* Feature grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.title}
                    className="flex items-start gap-3 p-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${f.accent}`}
                    >
                      <Icon size={20} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{f.title}</p>
                      <p className="text-xs text-white/60 mt-1 leading-relaxed">
                        {f.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── RIGHT: auth card ──────────────────────────────────────── */}
        <section className="flex items-center justify-center px-6 py-12 order-1 lg:order-2">
          <div
            className="w-full max-w-md rounded-3xl p-8 border border-white/15 shadow-2xl backdrop-blur-xl"
            style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
          >
            <div className="mb-6">
              <p className="text-xs uppercase tracking-widest text-accent-300 font-semibold mb-2">
                Comienza ahora
              </p>
              <h3 className="text-3xl font-bold">¡Bienvenido!</h3>
              <p className="text-white/70 text-sm mt-2">
                Inicia sesión para sincronizar tus datos en todos tus
                dispositivos, o continúa sin cuenta para usar la versión gratis.
              </p>
            </div>

            {error && (
              <div className="mb-4 bg-red-500/20 border border-red-400/40 rounded-xl px-4 py-2">
                <p className="text-red-100 text-xs">{error}</p>
              </div>
            )}

            {providerLinking?.required && (
              <div
                className="mb-4 bg-amber-500/20 border border-amber-300/40 rounded-xl px-4 py-3"
                data-testid="auth-provider-linking-message"
              >
                <p className="text-amber-50 text-sm font-semibold">Vinculación de cuenta requerida</p>
                <p className="text-amber-50/85 text-xs mt-1 leading-relaxed">
                  {providerLinking.message}
                </p>
              </div>
            )}

            {/* Primary: Google sign-in */}
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              data-testid="google-signin-btn"
              className="w-full flex items-center justify-center gap-3 bg-black text-white rounded-full py-3.5 font-semibold text-base shadow-lg hover:bg-neutral-900 active:scale-[0.99] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
                  <span>Iniciando sesión…</span>
                </>
              ) : (
                <>
                  <img
                    src="https://developers.google.com/identity/images/g-logo.png"
                    alt=""
                    className="w-5 h-5 rounded-full bg-white"
                  />
                  <span>Iniciar sesión con Google</span>
                </>
              )}
            </button>

            {/* Secondary */}
            <button
              onClick={handleGuest}
              disabled={loading}
              data-testid="guest-btn"
              className="mt-3 w-full text-white/80 hover:text-white text-sm font-medium py-3 rounded-full border border-white/15 hover:border-white/30 transition disabled:opacity-60"
            >
              Continuar sin iniciar sesión
            </button>

            {/* Plan summary */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-xs uppercase tracking-widest text-white/50 font-semibold mb-3">
                Planes
              </p>

              <div className="flex items-start gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
                  <Sparkles size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Gratis con anuncios</p>
                  <p className="text-xs text-white/60 mt-0.5 leading-snug">
                    1 empresa, facturación y compras incluidas. Algunas
                    funciones muestran un anuncio breve antes de continuar.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent-500/20 text-accent-300 flex items-center justify-center shrink-0">
                  <ShieldCheck size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Pro</p>
                  <p className="text-xs text-white/60 mt-0.5 leading-snug">
                    Multi-empresa, sin anuncios, exportación a Google Drive,
                    PDF por lotes y respaldo en la nube.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-white/45 text-center mt-6 leading-snug">
              Al continuar aceptas nuestros términos de servicio y política de
              privacidad.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
