import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class MapErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: '#0a1628',
          color: '#b0bec5',
          fontFamily: 'sans-serif',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <span style={{ fontSize: '2rem' }}>🗺</span>
          <p>Map failed to load. Please refresh the page.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
