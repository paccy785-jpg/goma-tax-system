import React from 'react';
import { AlertOctagon, RotateCw, Copy, Check, Home, ShieldAlert } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Called when the user chooses "Try Again / Return" — should navigate away
   * from the crashing view, otherwise the same deterministic render error
   * simply fires again. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public componentWillUnmount() {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    // Clearing state alone re-renders the exact same crashing child; navigating
    // (via onReset) is what actually gets the user out.
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleCopy = () => {
    const errorText = [
      `Error: ${this.state.error?.name}: ${this.state.error?.message}`,
      `Stack: ${this.state.error?.stack || 'No stack trace available'}`,
      `Component Stack: ${this.state.errorInfo?.componentStack || 'No component stack'}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n\n');

    navigator.clipboard.writeText(errorText).then(() => {
      this.setState({ copied: true });
      // Tracked timer: the bare setTimeout fired setState after the boundary
      // unmounted (e.g. after handleReset navigated away).
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.setState({ copied: false }), 2500);
    }).catch(() => {});
  };

  public render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'An unexpected error occurred';
      const errorStack = this.state.error?.stack;
      const componentStack = this.state.errorInfo?.componentStack;

      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6 lg:p-8">
          <div className="w-full max-w-2xl bg-slate-900 border border-rose-900/60 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 bg-rose-950/40 border-b border-rose-900/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
                  <AlertOctagon className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-base font-bold text-white tracking-tight">
                    Something went wrong
                  </h1>
                  <p className="text-xs text-rose-300/80 font-mono">
                    Application Error Caught
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-md text-[12px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Crash Intercepted
              </span>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                The portal encountered an unhandled runtime exception while rendering this view. 
                The application state has been preserved to prevent data loss. You can reload the page or review the detailed diagnostic trace below.
              </p>

              {/* Error Message Box */}
              <div className="rounded-xl bg-slate-950/80 border border-rose-900/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-[12px] font-bold uppercase tracking-wider text-rose-400">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Error Diagnostic
                  </span>
                  <button
                    type="button"
                    onClick={this.handleCopy}
                    className="inline-flex items-center gap-1 text-[12px] font-mono text-slate-400 hover:text-white transition-colors"
                  >
                    {this.state.copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Details</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-xs text-rose-200 break-words bg-rose-950/30 p-2.5 rounded-lg border border-rose-900/30">
                  {errorMessage}
                </div>
                {(errorStack || componentStack) && (
                  <details className="mt-2 text-xs text-slate-400">
                    <summary className="cursor-pointer text-[12px] font-semibold text-slate-300 hover:text-white py-1">
                      View full stack trace
                    </summary>
                    <pre className="mt-2 p-3 bg-black/60 rounded-lg text-[11px] font-mono text-slate-400 overflow-x-auto max-h-56 whitespace-pre-wrap border border-slate-800">
                      {errorStack || componentStack}
                    </pre>
                  </details>
                )}
              </div>

              {/* Recovery Actions */}
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700"
                >
                  <Home className="w-4 h-4" />
                  <span>Try Again / Return</span>
                </button>
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors shadow-md"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Reload Application</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
