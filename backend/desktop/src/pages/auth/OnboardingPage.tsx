import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, ArrowRight } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAllCompanies } from '@/store';
import { completeOnboarding } from '@/store/slices/authSlice';

import obWelcome from '@/assets/ob-01-welcome.png';
import obInvoices from '@/assets/ob-03-invoices.png';
import obSetup from '@/assets/ob-02-setup.png';
import obExport from '@/assets/ob-15-export.png';
import obSecurity from '@/assets/ob-06-security.png';

interface Slide {
  image: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  accent: string; // tailwind color token for the eyebrow pill
}

// Copy sourced from RN OnboardingScreen + marketing
const SLIDES: Slide[] = [
  {
    image: obWelcome,
    eyebrow: 'Bienvenido',
    title: 'Car Spa',
    subtitle:
      'Administra tus lavados, el punto de venta y tus documentos tributarios electrónicos, de manera fácil y rápida.',
    accent: 'bg-accent-500/20 text-accent-200',
  },
  {
    image: obInvoices,
    eyebrow: 'Multi-empresa',
    title: 'Gestiona múltiples emisores',
    subtitle:
      'Centraliza la facturación electrónica para múltiples empresas en un solo lugar, con total orden y control.',
    accent: 'bg-emerald-500/20 text-emerald-200',
  },
  {
    image: obSetup,
    eyebrow: 'Compras desde Gmail',
    title: 'Importa tus DTEs recibidos',
    subtitle:
      'Conecta tu cuenta de Gmail y Car Spa descargará automáticamente los DTEs que te envían tus proveedores.',
    accent: 'bg-purple-500/20 text-purple-200',
  },
  {
    image: obExport,
    eyebrow: 'Libros de IVA y exportación',
    title: 'Tus reportes fiscales, en un clic',
    subtitle:
      'Genera libros de IVA listos para presentar y exporta a Excel, JSON, PDF o Google Drive cuando lo necesites.',
    accent: 'bg-amber-500/20 text-amber-200',
  },
  {
    image: obSecurity,
    eyebrow: 'Gratis con anuncios',
    title: 'Empieza sin pagar',
    subtitle:
      'Usa la versión gratuita con anuncios cortos antes de algunas acciones, o actualiza a Pro para quitar anuncios y desbloquear multi-empresa, respaldo en la nube y exportación a Google Drive.',
    accent: 'bg-rose-500/20 text-rose-200',
  },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const companies = useAppSelector(selectAllCompanies);
  const [current, setCurrent] = useState(0);

  const isLast = current === SLIDES.length - 1;
  const slide = SLIDES[current];

  function finish() {
    dispatch(completeOnboarding());
    navigate(companies.length === 0 ? '/companies/add' : '/home', {
      replace: true,
    });
  }

  function next() {
    if (isLast) finish();
    else setCurrent((c) => c + 1);
  }

  function prev() {
    if (current > 0) setCurrent((c) => c - 1);
  }

  return (
    <div
      data-testid="onboarding"
      className="relative min-h-screen w-full overflow-hidden text-white"
      style={{
        background:
          'linear-gradient(135deg, #0b1220 0%, #13213a 50%, #0f3b3a 100%)',
      }}
    >
      {/* Decorative orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[420px] h-[420px] rounded-full bg-accent-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[480px] h-[480px] rounded-full bg-sky-400/15 blur-3xl" />
      </div>

      {/* Skip */}
      <button
        onClick={finish}
        className="absolute top-5 right-6 text-white/60 hover:text-white text-sm font-medium px-3 py-1.5 rounded-full hover:bg-white/5 transition z-20"
        data-testid="onboarding-skip-btn"
      >
        Omitir
      </button>

      <div className="relative min-h-screen flex items-center justify-center px-6 py-10">
        <div
          className="w-full max-w-5xl rounded-3xl border border-white/15 shadow-2xl backdrop-blur-xl overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[520px]">
            {/* ─── IMAGE SIDE ─────────────────────────────────────── */}
            <div
              className="relative flex items-center justify-center p-10 lg:p-14"
              style={{
                background:
                  'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08), transparent 60%)',
              }}
            >
              <img
                key={slide.image}
                src={slide.image}
                alt=""
                className="w-full max-w-sm object-contain drop-shadow-2xl animate-fade-in"
              />
            </div>

            {/* ─── TEXT SIDE ──────────────────────────────────────── */}
            <div className="flex flex-col justify-between p-10 lg:p-14">
              <div>
                <span
                  className={`inline-block text-xs font-semibold uppercase tracking-widest rounded-full px-3 py-1 mb-5 ${slide.accent}`}
                >
                  {slide.eyebrow}
                </span>
                <h2 className="text-3xl lg:text-4xl font-bold leading-tight mb-4">
                  {slide.title}
                </h2>
                <p className="text-white/75 text-base leading-relaxed">
                  {slide.subtitle}
                </p>
              </div>

              <div className="mt-10">
                {/* Progress dots */}
                <div className="flex items-center gap-2 mb-8">
                  {SLIDES.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrent(i)}
                      aria-label={`Ir al paso ${i + 1}`}
                      className={[
                        'h-2 rounded-full transition-all',
                        i === current
                          ? 'w-8 bg-white'
                          : 'w-2 bg-white/30 hover:bg-white/60',
                      ].join(' ')}
                    />
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={prev}
                    disabled={current === 0}
                    className="w-11 h-11 rounded-full border border-white/20 flex items-center justify-center text-white/80 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    aria-label="Anterior"
                  >
                    <ChevronLeft size={20} />
                  </button>

                  <button
                    onClick={next}
                    data-testid="onboarding-next-btn"
                    className="flex-1 flex items-center justify-center gap-2 bg-white text-brand-900 font-semibold rounded-full py-3.5 text-base shadow-lg hover:bg-white/90 active:scale-[0.99] transition"
                  >
                    <span>{isLast ? 'Comenzar' : 'Siguiente'}</span>
                    {isLast ? <ArrowRight size={18} /> : <ChevronRight size={18} />}
                  </button>
                </div>

                {/* Step counter */}
                <p className="text-xs text-white/40 text-center mt-5">
                  Paso {current + 1} de {SLIDES.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
