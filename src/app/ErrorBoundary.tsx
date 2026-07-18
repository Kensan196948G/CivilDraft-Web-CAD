/**
 * React エラー境界。
 * コンポーネントツリー内の捕捉されない例外を捕捉し、クラッシュ画面の代わりに
 * フォールバックUIを表示する。エラー詳細は本番では隠蔽し、開発モードでのみ表示する。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  readonly children: ReactNode
  readonly fallback?: ReactNode
}

interface ErrorBoundaryState {
  readonly hasError: boolean
  readonly error: Error | null
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
  backgroundColor: 'var(--color-bg, #f5f5f5)',
  color: 'var(--color-text, #333)',
}

const headingStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 600,
  marginBottom: '1rem',
}

const messageStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  color: 'var(--color-text-secondary, #666)',
  marginBottom: '1.5rem',
  textAlign: 'center',
  maxWidth: '480px',
}

const buttonStyle: React.CSSProperties = {
  padding: '0.6rem 1.5rem',
  fontSize: '0.9rem',
  fontWeight: 500,
  border: '1px solid var(--color-border, #ccc)',
  borderRadius: '6px',
  backgroundColor: 'var(--color-surface, #fff)',
  color: 'var(--color-text, #333)',
  cursor: 'pointer',
}

const detailStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '1rem',
  maxWidth: '600px',
  width: '100%',
  backgroundColor: 'var(--color-code-bg, #f0f0f0)',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflow: 'auto',
  maxHeight: '200px',
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught React error:', error.message, {
      componentStack: info.componentStack ?? '(unknown)',
      errorName: error.name,
    })
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const isDev = import.meta.env.DEV

      return (
        <div style={containerStyle} role="alert">
          <h1 style={headingStyle}>⚠️ 予期しないエラーが発生しました</h1>
          <p style={messageStyle}>
            アプリケーションで問題が発生しました。ページを再読み込みするか、
            しばらく時間をおいてから再度お試しください。
          </p>
          <button
            style={buttonStyle}
            onClick={() => window.location.reload()}
            type="button"
          >
            ページを再読み込み
          </button>
          {isDev && this.state.error && (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                開発者向けエラー詳細
              </summary>
              <pre style={detailStyle}>
                {this.state.error.name}: {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack ?? '(スタックトレースなし)'}
              </pre>
            </details>
          )}
        </div>
      )
    }

    return this.props.children
  }
}