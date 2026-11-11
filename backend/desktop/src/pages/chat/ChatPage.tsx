import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  MessageCircle,
  Bot,
  User,
  AlertCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { useAppSelector } from '@/store';
import { selectCurrentUser, selectIsAuthenticated } from '@/store/selectors/authSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { chatService } from '@/services/chat/ChatService';
import { CHAT_SIGN_IN_REQUIRED_MESSAGE } from '@/services/chat/ChatAuthService';
import type { ChatMessage } from '@/types/chat';

// ─── helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ahora mismo';
  if (min === 1) return 'hace 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h === 1) return 'hace 1 hora';
  if (h < 24) return `hace ${h} horas`;
  return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
}

const SUGGESTIONS = [
  '¿Cuántas facturas tengo este mes?',
  '¿Cómo anulo una factura?',
  'Explícame los tipos de DTE',
  '¿Cómo exporto los libros de IVA?',
];

// ─── sub-components ────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-4">
      <div className="w-7 h-7 rounded-full bg-accent-100 flex items-center justify-center shrink-0">
        <Bot size={14} className="text-accent-600" />
      </div>
      <div className="bg-white border border-brand-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-end gap-2 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-accent-600' : 'bg-accent-100'
        }`}
      >
        {isUser ? (
          <User size={14} className="text-white" />
        ) : (
          <Bot size={14} className="text-accent-600" />
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[72%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-accent-600 text-white rounded-br-sm'
              : 'bg-white border border-brand-100 text-brand-800 rounded-bl-sm'
          }`}
        >
          {message.content}
        </div>

        {/* Citations */}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {message.citations.map((c, idx) => (
              <a
                key={idx}
                href={c.url ?? '#'}
                target={c.url ? '_blank' : undefined}
                rel="noreferrer"
                className="text-xs px-2 py-0.5 rounded-full bg-accent-50 text-accent-700 border border-accent-200 hover:bg-accent-100 transition-colors"
              >
                {c.title || c.source || `Fuente ${idx + 1}`}
              </a>
            ))}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-xs text-brand-400 px-1">{relativeTime(message.timestamp)}</span>
      </div>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const user = useAppSelector(selectCurrentUser);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const currentCompany = useAppSelector(selectCurrentCompany);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null); // null = checking
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCompanyIdRef = useRef<string | null>(currentCompany?.id ?? null);

  // Auto-scroll to bottom whenever messages or typing state change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Test connectivity on mount
  useEffect(() => {
    let cancelled = false;
    chatService.testConnection().then((ok) => {
      if (!cancelled) setIsConnected(ok);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const nextCompanyId = currentCompany?.id ?? null;
    if (activeCompanyIdRef.current === nextCompanyId) {
      return;
    }

    activeCompanyIdRef.current = nextCompanyId;
    chatService.invalidateAuth();
    setSessionId(null);
    setMessages([]);
    setError(null);
    setIsTyping(false);
  }, [currentCompany?.id]);

  const apiUnreachable = isConnected === false;
  const signInRequired = !isAuthenticated && !chatService.supportsGuestAccess();
  const inputDisabled = apiUnreachable || isTyping || signInRequired;
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    if (signInRequired) {
      setError(CHAT_SIGN_IN_REQUIRED_MESSAGE);
      return;
    }

    setError(null);
    setInputText('');

    // Optimistically add user message
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      sessionId: sessionId ?? '',
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      let activeSessionId = sessionId;

      // Create session on first message
      if (!activeSessionId) {
        const userId = user?.id ?? user?.email ?? 'guest';
        const contactName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || undefined;
        const companyName = currentCompany?.nombreComercial || currentCompany?.nombre || undefined;
        const metadata: Record<string, string> = {
          source: 'desktop-app',
        };

        if (currentCompany?.nit) {
          metadata.companyNit = currentCompany.nit;
        }

        if (companyName) {
          metadata.companyName = companyName;
        }

        if (user?.email) {
          metadata.email = user.email;
        }

        const sessionRes = await chatService.createSession({
          userId,
          title: trimmed.slice(0, 60),
          contactName,
          channel: 'chat',
          metadata,
        });
        if (!sessionRes.success || !sessionRes.data) {
          throw new Error(sessionRes.message ?? 'No se pudo crear la sesión');
        }
        activeSessionId = sessionRes.data.id;
        setSessionId(activeSessionId);
        // Fix sessionId on the optimistic user message
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsg.id ? { ...m, sessionId: activeSessionId! } : m)),
        );
      }

      const msgRes = await chatService.sendMessage(activeSessionId, trimmed);
      if (!msgRes.success || !msgRes.data) {
        throw new Error(msgRes.message ?? 'Sin respuesta del asistente');
      }

      setMessages((prev) => [...prev, msgRes.data!]);
    } catch (err) {
      setError((err as Error).message ?? 'Error al enviar el mensaje');
      // Remove the optimistic user message on error
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  }, [currentCompany, isTyping, sessionId, signInRequired, user]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div data-testid="chat" className="flex flex-col h-full max-h-[calc(100vh-120px)] space-y-4">
      <PageHeader
        title="Chat Soporte"
        subtitle="Asistente con inteligencia artificial"
      />

      {/* Connectivity error banner */}
      {apiUnreachable && (
        <div data-testid="chat-api-unreachable" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          <span>No se puede conectar con el asistente en este momento. Verifica tu conexión e intenta más tarde.</span>
        </div>
      )}

      {signInRequired && !apiUnreachable && (
        <div data-testid="chat-signin-required" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0" />
          <span>{CHAT_SIGN_IN_REQUIRED_MESSAGE}</span>
        </div>
      )}

      {/* General error banner */}
      {error && !apiUnreachable && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
          <button
            className="ml-auto text-red-500 hover:text-red-700 font-medium"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Chat card */}
      <Card className="flex-1 flex flex-col overflow-hidden min-h-0" padding="none">

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-2">
          {isEmpty ? (
            /* Empty state with suggestions */
            <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
              <div className="w-16 h-16 rounded-full bg-accent-50 flex items-center justify-center">
                <MessageCircle size={30} className="text-accent-500" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-brand-700 text-base">¿En qué puedo ayudarte?</p>
                <p className="text-sm text-brand-400 mt-1">
                  Consulta sobre tus facturas, clientes, DTE y más.
                </p>
              </div>
              {/* Suggestion chips */}
              {!apiUnreachable && !signInRequired && (
                <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="px-3 py-2 rounded-full text-sm border border-accent-200 text-accent-700 bg-accent-50 hover:bg-accent-100 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {isTyping && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-brand-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              data-testid="chat-input"
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={inputDisabled}
              placeholder={
                apiUnreachable
                  ? 'Asistente no disponible...'
                  : signInRequired
                  ? 'Inicia sesión para usar el chat...'
                  : isTyping
                  ? 'El asistente está escribiendo...'
                  : 'Escribe tu consulta...'
              }
              className={[
                'flex-1 rounded-lg border px-4 py-2.5 text-sm outline-none transition-colors',
                inputDisabled
                  ? 'border-brand-200 bg-brand-50 text-brand-400 cursor-not-allowed'
                  : 'border-brand-200 bg-white text-brand-800 focus:border-accent-400 focus:ring-1 focus:ring-accent-300',
              ].join(' ')}
            />
            <Button
              data-testid="chat-send"
              variant="primary"
              icon={<Send size={16} />}
              disabled={!inputText.trim() || inputDisabled}
              onClick={() => sendMessage(inputText)}
              aria-label="Enviar mensaje"
            />
          </div>
          <p className="text-xs text-brand-300 mt-2 text-center">
            Las respuestas son generadas por IA y pueden contener errores. Verifica información importante.
          </p>
        </div>
      </Card>
    </div>
  );
}
