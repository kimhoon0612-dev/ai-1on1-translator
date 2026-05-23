import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'center',
          height: '100vh', width: '100vw', textAlign: 'center',
          padding: '2rem',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>😵</div>
          <h2>오류가 발생했습니다</h2>
          <p style={{ color: '#94a3b8', maxWidth: 400 }}>
            {this.state.error?.message || '알 수 없는 오류'}
          </p>
          <button
            className="btn primary"
            style={{ maxWidth: 200, marginTop: '1rem' }}
            onClick={() => window.location.href = '/'}
          >
            홈으로 돌아가기
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
