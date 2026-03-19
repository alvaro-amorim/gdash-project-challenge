import { useEffect, useRef } from 'react';
import { GOOGLE_CLIENT_ID } from './api';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number | boolean>,
          ) => void;
        };
      };
    };
  }
}

interface GoogleLoginButtonProps {
  disabled: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}

export function GoogleLoginButton({
  disabled,
  onCredential,
  onError,
}: GoogleLoginButtonProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !buttonRef.current) {
      return;
    }

    let cancelled = false;

    const loadGoogleScript = async () => {
      if (window.google?.accounts?.id) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>(
          'script[data-google-identity="true"]',
        );

        if (existingScript) {
          if (window.google?.accounts?.id) {
            resolve();
            return;
          }

          existingScript.addEventListener('load', () => resolve(), { once: true });
          existingScript.addEventListener(
            'error',
            () => reject(new Error('Failed to load Google login')),
            { once: true },
          );
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentity = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google login'));
        document.head.appendChild(script);
      });
    };

    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google?.accounts?.id) {
          return;
        }

        buttonRef.current.innerHTML = '';

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (!response.credential) {
              onError('Nao foi possivel autenticar com o Google.');
              return;
            }

            onCredential(response.credential);
          },
        });

        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          text: 'signin_with',
          size: 'large',
          width: 320,
        });
      })
      .catch(() => {
        onError('Falha ao carregar o login com Google.');
      });

    return () => {
      cancelled = true;
    };
  }, [onCredential, onError]);

  if (!GOOGLE_CLIENT_ID) {
    return null;
  }

  return (
    <div className={`flex justify-center ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <div ref={buttonRef} />
    </div>
  );
}
