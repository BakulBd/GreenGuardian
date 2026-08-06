"use client";

/**
 * Application-wide error boundary.
 *
 * Next.js `error.tsx` files only catch render errors inside their own route
 * segment; a throw from a shared provider or a client-side listener would
 * otherwise blank the page. This keeps the user on a recoverable screen —
 * important during an exam, where a white page means a lost attempt.
 */

import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the details in the console for support; no external reporting service
    // is configured, and sending them anywhere would be a privacy decision.
    console.error("[ErrorBoundary] Unhandled UI error:", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full rounded-lg border bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-7 w-7 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-600">
            The page hit an unexpected error. Your saved work is not affected — try
            again, and if it keeps happening reload the page.
          </p>
          {process.env.NODE_ENV !== "production" && (
            <pre className="mt-4 max-h-40 overflow-auto rounded bg-gray-100 p-2 text-left text-xs text-red-700">
              {error.message}
            </pre>
          )}
          <div className="mt-6 flex gap-2">
            <Button className="flex-1" onClick={this.handleReset}>
              Try again
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.location.reload()}
            >
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
