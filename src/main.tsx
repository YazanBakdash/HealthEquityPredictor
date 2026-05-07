import { Component, StrictMode, type ReactNode } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  declare props: { children: ReactNode };
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unknown runtime error',
    };
  }

  componentDidCatch(error: unknown) {
    console.error('App render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
          <h1>App crashed during render</h1>
          <p>{this.state.message}</p>
          <p>Open browser DevTools Console for full details.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
