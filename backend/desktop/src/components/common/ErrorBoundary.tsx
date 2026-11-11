import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { TelemetryService } from '@/services/telemetry/TelemetryService';
import { LocalLogger } from '@/services/logging/LocalLogger';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Unhandled error:', error, info);
    LocalLogger.error('ui', 'React render error', error, {
      componentStack: info.componentStack?.slice(0, 500) ?? '',
    });
    TelemetryService.trackException(error, {
      componentStack: info.componentStack?.slice(0, 500) ?? '',
      source: 'ErrorBoundary',
    });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const message = this.state.error?.message ?? 'Error desconocido';

      return (
        <div className="flex items-center justify-center min-h-[200px] p-6">
          <Card className="max-w-md w-full border-red-200 bg-red-50" padding="lg">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={24} className="text-red-600" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-red-800">
                  Algo salió mal
                </h3>
                <p className="text-sm text-red-600 break-words">{message}</p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  onClick={this.handleRetry}
                >
                  Reintentar
                </Button>
                <a
                  href={`mailto:soporte@facturassimples.com?subject=Error%20en%20app&body=${encodeURIComponent(message)}`}
                  className="inline-flex items-center text-sm text-red-600 hover:text-red-800 underline underline-offset-2 transition-colors"
                >
                  Reportar
                </a>
              </div>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
